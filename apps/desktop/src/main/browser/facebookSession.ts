import { createHmac } from 'node:crypto'
import type { BrowserContext, Locator, Page } from 'playwright-core'
import type { AccountStatus } from '../../shared/accounts'
import type { FacebookLocale } from '../../shared/appSettings'

export interface FacebookSessionAccount {
  id: number
  uid: string
  username: string | null
  password: string | null
  cookie: string | null
  twoFactorSecret: string | null
}

export type FacebookSessionReason =
  | 'valid'
  | 'login_required'
  | 'checkpoint'
  | 'two_factor_missing'
  | 'two_factor_failed'
  | 'login_failed'
  | 'unknown'

export type FacebookSessionGate =
  | 'valid'
  | 'login'
  | 'saved_profile'
  | 'password_only'
  | 'two_factor'
  | 'manual_verification'
  | 'unknown'

export interface FacebookSessionResult {
  accountId: number
  status: AccountStatus
  reason: FacebookSessionReason
  cookie: string | null
  cookieStatus: 'valid' | 'needs_login' | 'error'
  lastCookieCheck: number
  message: string
  profileName?: string | null
}

export interface FacebookCookieInput {
  name: string
  value: string
  domain: string
  path: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

export interface FacebookSessionGateInput {
  url: string
  hasUserCookie: boolean
  loginFormVisible: boolean
  twoFactorVisible: boolean
  manualVerificationTextVisible: boolean
  savedProfileVisible?: boolean
  passwordOnlyVisible?: boolean
}

export interface FacebookSessionValidation {
  state: 'valid' | 'needs_login' | 'verification_required'
  message: string
}

type ContextCookie = FacebookCookieInput

type TwoFactorSubmitResult = {
  submitted: boolean
  code: string | null
}

const SAVED_PROFILE_CONTINUE_PATTERN = /^(continue|tiếp tục|lanjutkan)$/i
const USE_ANOTHER_PROFILE_PATTERN = /use another (?:profile|account)|dùng (?:một )?(?:trang cá nhân|hồ sơ|tài khoản) khác|sử dụng (?:một )?(?:trang cá nhân|hồ sơ|tài khoản) khác|gunakan (?:profil|akun) lain/i
const LOGIN_ACTION_PATTERN = /^(log in|login|đăng nhập|masuk)$/i
const PASSWORD_SUBMIT_PATTERN = /^(continue|tiếp tục|lanjutkan|log in|login|đăng nhập|masuk)$/i
const TWO_FACTOR_SUBMIT_PATTERN = /^(continue|tiếp tục|submit|gửi|confirm|xác nhận)$/i
const TWO_FACTOR_INPUT_TIMEOUT_MS = 20_000
const TWO_FACTOR_OUTCOME_TIMEOUT_MS = 15_000
const TWO_FACTOR_MAX_ATTEMPTS = 2
const TOTP_STEP_MS = 30_000
const TOTP_MIN_REMAINING_MS = 8_000
const TOTP_WINDOW_BUFFER_MS = 750

function twoFactorCredentialKind(secret: string): 'direct_code' | 'totp_secret' {
  return isDirectTwoFactorCode(secret) ? 'direct_code' : 'totp_secret'
}

function twoFactorDiagnostic(accountId: number, stage: string, detail = ''): void {
  console.info(`[PAGE-AUTO session] account=${accountId} state=two_factor stage=${stage}${detail ? ` ${detail}` : ''}`)
}

function normalizeSameSite(value: unknown): FacebookCookieInput['sameSite'] | undefined {
  if (value === 'Strict' || value === 'Lax' || value === 'None') return value
  if (typeof value !== 'string') return undefined
  const normalized = value.toLowerCase()
  if (normalized === 'strict') return 'Strict'
  if (normalized === 'lax') return 'Lax'
  if (normalized === 'none' || normalized === 'no_restriction') return 'None'
  return undefined
}

function jsonCookie(raw: Record<string, unknown>): ContextCookie | null {
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const value = typeof raw.value === 'string' ? raw.value : ''
  if (!name) return null

  const domain = typeof raw.domain === 'string' && raw.domain.trim() ? raw.domain.trim() : '.facebook.com'
  const path = typeof raw.path === 'string' && raw.path.trim() ? raw.path.trim() : '/'
  const cookie: ContextCookie = { name, value, domain, path }

  if (typeof raw.expires === 'number' && Number.isFinite(raw.expires) && raw.expires > 0) cookie.expires = raw.expires
  else if (typeof raw.expirationDate === 'number' && Number.isFinite(raw.expirationDate) && raw.expirationDate > 0) cookie.expires = raw.expirationDate
  if (typeof raw.httpOnly === 'boolean') cookie.httpOnly = raw.httpOnly
  if (typeof raw.secure === 'boolean') cookie.secure = raw.secure
  const sameSite = normalizeSameSite(raw.sameSite)
  if (sameSite) cookie.sameSite = sameSite
  return cookie
}

export function parseFacebookCookies(rawCookie: string | null | undefined): ContextCookie[] {
  const raw = rawCookie?.trim()
  if (!raw) return []

  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .map(jsonCookie)
          .filter((item): item is ContextCookie => item !== null)
      }
    } catch {
      // Fall back to header-style parsing below.
    }
  }

  return raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): ContextCookie | null => {
      const separator = part.indexOf('=')
      if (separator <= 0) return null
      const name = part.slice(0, separator).trim()
      const value = part.slice(separator + 1).trim()
      if (!name) return null
      return { name, value, domain: '.facebook.com', path: '/', secure: true }
    })
    .filter((item): item is ContextCookie => item !== null)
}

export function storedFacebookCookieUserId(rawCookie: string | null | undefined): string | null {
  return parseFacebookCookies(rawCookie).find((cookie) => cookie.name === 'c_user')?.value?.trim() || null
}

export function facebookUserIdMatchesExpected(actualUserId: string | null | undefined, expectedUid: string): boolean {
  const actual = actualUserId?.trim()
  if (!actual) return false
  const expected = expectedUid.trim()
  if (!/^\d+$/.test(expected)) return true
  return actual === expected
}

export function canUseStoredFacebookCookies(rawCookie: string | null | undefined, expectedUid: string): boolean {
  return facebookUserIdMatchesExpected(storedFacebookCookieUserId(rawCookie), expectedUid)
}

function decodeBase32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const normalized = secret.toUpperCase().replace(/[^A-Z2-7]/g, '')
  if (!normalized) throw new Error('2FA secret không hợp lệ.')

  let bits = ''
  for (const char of normalized) {
    const value = alphabet.indexOf(char)
    if (value < 0) throw new Error('2FA secret không hợp lệ.')
    bits += value.toString(2).padStart(5, '0')
  }

  const bytes: number[] = []
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2))
  }
  return Buffer.from(bytes)
}

function extractTotpSecret(rawSecret: string): string {
  const trimmed = rawSecret.trim()
  if (!trimmed.toLowerCase().startsWith('otpauth://')) return trimmed
  try {
    return new URL(trimmed).searchParams.get('secret') ?? ''
  } catch {
    return ''
  }
}

function isDirectTwoFactorCode(rawSecret: string): boolean {
  return /^\d{6,8}$/.test(rawSecret.trim().replace(/\s+/g, ''))
}

export function generateTotp(secret: string, timestampMs = Date.now(), digits = 6): string {
  const key = decodeBase32(extractTotpSecret(secret))
  const counter = Math.floor(timestampMs / TOTP_STEP_MS)
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', key).update(buffer).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const binary = ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff)
  const modulo = 10 ** digits
  return String(binary % modulo).padStart(digits, '0')
}

export function resolveTwoFactorCode(rawSecret: string, timestampMs = Date.now()): string {
  const directCode = rawSecret.trim().replace(/\s+/g, '')
  if (isDirectTwoFactorCode(rawSecret)) return directCode
  return generateTotp(rawSecret, timestampMs, 6)
}

export function twoFactorCodeFreshnessWaitMs(rawSecret: string, timestampMs = Date.now()): number {
  if (isDirectTwoFactorCode(rawSecret)) return 0
  const elapsed = ((timestampMs % TOTP_STEP_MS) + TOTP_STEP_MS) % TOTP_STEP_MS
  const remaining = TOTP_STEP_MS - elapsed
  return remaining < TOTP_MIN_REMAINING_MS ? remaining + TOTP_WINDOW_BUFFER_MS : 0
}

export function facebookLocaleCookieValue(locale: FacebookLocale): string | null {
  if (locale === 'vi-VN') return 'vi_VN'
  if (locale === 'en-US') return 'en_US'
  return null
}

export async function applyFacebookLocale(context: BrowserContext, locale: FacebookLocale): Promise<void> {
  const value = facebookLocaleCookieValue(locale)
  if (!value) return
  await context.addCookies([{ name: 'locale', value, domain: '.facebook.com', path: '/', secure: true, sameSite: 'Lax' }])
}

async function currentFacebookUserId(context: BrowserContext): Promise<string | null> {
  const cookies = await context.cookies('https://www.facebook.com')
  return cookies.find((cookie) => cookie.name === 'c_user')?.value?.trim() || null
}

async function serializeFacebookCookies(context: BrowserContext): Promise<string | null> {
  const cookies = await context.cookies('https://www.facebook.com')
  const facebookCookies = cookies.filter((cookie) => cookie.domain.endsWith('facebook.com'))
  if (facebookCookies.length === 0) return null
  return facebookCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

function loginIdentifierInput(page: Page): Locator {
  return page.locator('input[name="email"], #email').first()
}

function loginPasswordInput(page: Page): Locator {
  return page.locator('input[name="pass"], #pass').first()
}

async function loginInputVisibility(page: Page): Promise<{ loginFormVisible: boolean; passwordOnlyVisible: boolean }> {
  const [identifierVisible, passwordVisible] = await Promise.all([
    loginIdentifierInput(page).isVisible().catch(() => false),
    loginPasswordInput(page).isVisible().catch(() => false)
  ])
  return {
    loginFormVisible: identifierVisible && passwordVisible,
    passwordOnlyVisible: !identifierVisible && passwordVisible
  }
}

function isTwoFactorVerificationUrl(url: string): boolean {
  return url.toLowerCase().includes('/two_step_verification/')
}

function isManualVerificationUrl(url: string): boolean {
  const normalized = url.toLowerCase()
  return normalized.includes('/checkpoint/')
    || normalized.includes('/recover/')
    || normalized.includes('/confirmemail')
    || normalized.includes('/identity/')
}

async function hasManualVerificationText(page: Page): Promise<boolean> {
  const marker = page.getByText(/confirm your identity|xác minh danh tính|phê duyệt đăng nhập|upload.*id|tải.*giấy tờ|verify your identity/i).first()
  return marker.isVisible().catch(() => false)
}

async function hasAuthenticatorPrompt(page: Page): Promise<boolean> {
  const marker = page.getByText(/authentication app|authenticator app|code generator|two[- ]factor authentication|security code.*app|xác thực hai yếu tố|ứng dụng xác thực|trình tạo mã/i).first()
  return marker.isVisible().catch(() => false)
}

async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  return null
}

async function firstVisibleEnabled(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    const count = await candidate.count().catch(() => 0)
    for (let index = 0; index < count; index += 1) {
      const item = candidate.nth(index)
      if (!await item.isVisible().catch(() => false)) continue
      if (await item.isEnabled().catch(() => true)) return item
    }
  }
  return null
}

async function domClick(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    if (element instanceof HTMLElement) {
      element.click()
      return true
    }
    return element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
  }).then(() => true).catch(() => false)
}

async function findSavedProfileContinue(page: Page): Promise<Locator | null> {
  const useAnotherProfile = await firstVisible([
    page.getByRole('button', { name: USE_ANOTHER_PROFILE_PATTERN }).first(),
    page.getByRole('link', { name: USE_ANOTHER_PROFILE_PATTERN }).first(),
    page.getByText(USE_ANOTHER_PROFILE_PATTERN).first()
  ])
  if (!useAnotherProfile) return null

  return firstVisible([
    page.getByRole('button', { name: SAVED_PROFILE_CONTINUE_PATTERN }).first(),
    page.getByRole('link', { name: SAVED_PROFILE_CONTINUE_PATTERN }).first(),
    page.getByText(SAVED_PROFILE_CONTINUE_PATTERN).first()
  ])
}

async function findUseAnotherProfile(page: Page): Promise<Locator | null> {
  return firstVisible([
    page.getByRole('button', { name: USE_ANOTHER_PROFILE_PATTERN }).first(),
    page.getByRole('link', { name: USE_ANOTHER_PROFILE_PATTERN }).first(),
    page.getByText(USE_ANOTHER_PROFILE_PATTERN).first()
  ])
}

async function findTwoFactorInput(page: Page): Promise<Locator | null> {
  const directInput = await firstVisible([
    page.locator('input[name="approvals_code"]').first(),
    page.locator('input[name="approvalsCode"]').first(),
    page.locator('input[name="code"]').first(),
    page.locator('input[autocomplete="one-time-code"]').first(),
    page.locator('input[inputmode="numeric"]').first(),
    page.locator('input[type="tel"]').first(),
    page.locator('input[name*="otp" i]').first(),
    page.locator('input[id*="code" i]').first(),
    page.locator('input[placeholder*="code" i]').first(),
    page.locator('input[aria-label*="code" i]').first()
  ])
  if (directInput) return directInput

  if (!isTwoFactorVerificationUrl(page.url()) && !await hasAuthenticatorPrompt(page)) return null

  return firstVisible([
    page.locator('input[type="text"]:visible').first(),
    page.locator('input:not([type]):visible').first()
  ])
}

async function isTwoFactorSurfaceActive(page: Page): Promise<boolean> {
  if (isTwoFactorVerificationUrl(page.url())) return true
  if (await hasAuthenticatorPrompt(page)) return true
  return Boolean(await findTwoFactorInput(page))
}

async function waitForTwoFactorInputReady(page: Page, timeoutMs = TWO_FACTOR_INPUT_TIMEOUT_MS): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    const input = await findTwoFactorInput(page)
    if (input && await input.isEnabled().catch(() => true)) return input
    if (!await isTwoFactorSurfaceActive(page)) return null
    await page.waitForTimeout(200)
  }
  return null
}

async function findTwoFactorSubmit(page: Page, timeoutMs = 8_000): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    const submit = await firstVisibleEnabled([
      page.getByRole('button', { name: TWO_FACTOR_SUBMIT_PATTERN }),
      page.getByRole('link', { name: TWO_FACTOR_SUBMIT_PATTERN }),
      page.locator('button[type="submit"]:visible'),
      page.locator('input[type="submit"]:visible'),
      page.getByText(TWO_FACTOR_SUBMIT_PATTERN, { exact: true })
    ])
    if (submit) return submit
    if (!await isTwoFactorSurfaceActive(page)) return null
    await page.waitForTimeout(200)
  }
  return null
}

export function classifyFacebookSessionGate(input: FacebookSessionGateInput): FacebookSessionGate {
  if (input.twoFactorVisible) return 'two_factor'
  if (isManualVerificationUrl(input.url) || input.manualVerificationTextVisible) return 'manual_verification'
  if (input.passwordOnlyVisible) return 'password_only'
  if (input.savedProfileVisible) return 'saved_profile'
  if (input.loginFormVisible) return 'login'
  if (input.hasUserCookie) return 'valid'
  return 'unknown'
}

export async function inspectFacebookSessionGate(context: BrowserContext, page: Page): Promise<FacebookSessionGate> {
  const [userId, loginInputs, twoFactorInput, manualVerificationTextVisible, savedProfileContinue] = await Promise.all([
    currentFacebookUserId(context),
    loginInputVisibility(page),
    findTwoFactorInput(page),
    hasManualVerificationText(page),
    findSavedProfileContinue(page)
  ])

  return classifyFacebookSessionGate({
    url: page.url(),
    hasUserCookie: Boolean(userId),
    loginFormVisible: loginInputs.loginFormVisible,
    passwordOnlyVisible: loginInputs.passwordOnlyVisible,
    savedProfileVisible: Boolean(savedProfileContinue),
    twoFactorVisible: Boolean(twoFactorInput),
    manualVerificationTextVisible
  })
}

async function waitForPostLoginGate(context: BrowserContext, page: Page, timeoutMs = 12_000): Promise<FacebookSessionGate> {
  const deadline = Date.now() + timeoutMs
  let latest: FacebookSessionGate = 'unknown'
  while (Date.now() < deadline) {
    latest = await inspectFacebookSessionGate(context, page)
    if (latest === 'unknown' && isTwoFactorVerificationUrl(page.url())) return 'two_factor'
    if (
      latest === 'valid'
      || latest === 'two_factor'
      || latest === 'manual_verification'
      || latest === 'password_only'
    ) return latest
    await page.waitForTimeout(250)
  }
  return latest
}

async function waitForPasswordOnlyTransition(
  context: BrowserContext,
  page: Page,
  timeoutMs = 12_000
): Promise<FacebookSessionGate> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const gate = await inspectFacebookSessionGate(context, page)
    if (gate === 'unknown' && isTwoFactorVerificationUrl(page.url())) return 'two_factor'
    if (
      gate === 'valid'
      || gate === 'two_factor'
      || gate === 'manual_verification'
      || gate === 'login'
    ) return gate
    await page.waitForTimeout(250)
  }
  return 'unknown'
}

async function waitForTwoFactorOutcome(
  context: BrowserContext,
  page: Page,
  timeoutMs = TWO_FACTOR_OUTCOME_TIMEOUT_MS
): Promise<FacebookSessionGate> {
  const deadline = Date.now() + timeoutMs
  let latest: FacebookSessionGate = 'two_factor'
  while (Date.now() < deadline) {
    latest = await inspectFacebookSessionGate(context, page)
    if (latest === 'valid' || latest === 'manual_verification' || latest === 'password_only' || latest === 'login' || latest === 'saved_profile') {
      return latest
    }
    if (latest === 'unknown' && !await isTwoFactorSurfaceActive(page)) return latest
    await page.waitForTimeout(250)
  }
  return latest
}

async function waitForLoginSurfaceGate(
  context: BrowserContext,
  page: Page,
  timeoutMs = 12_000
): Promise<FacebookSessionGate> {
  const deadline = Date.now() + timeoutMs
  let latest: FacebookSessionGate = 'unknown'
  while (Date.now() < deadline) {
    latest = await inspectFacebookSessionGate(context, page)
    if (latest === 'unknown' && isTwoFactorVerificationUrl(page.url())) return 'two_factor'
    if (latest !== 'unknown') return latest
    await page.waitForTimeout(250)
  }
  return latest
}

async function openExplicitFacebookLoginSurface(
  context: BrowserContext,
  page: Page,
  timeoutMs = 12_000
): Promise<FacebookSessionGate> {
  await page.goto('https://www.facebook.com/login/', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000
  }).catch(() => undefined)
  return waitForLoginSurfaceGate(context, page, timeoutMs)
}

async function clickSavedProfileContinue(page: Page): Promise<boolean> {
  const continueAction = await findSavedProfileContinue(page)
  if (!continueAction) return false
  try {
    await continueAction.scrollIntoViewIfNeeded().catch(() => undefined)
    await continueAction.click({ timeout: 15_000 })
  } catch {
    return false
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined)
  await page.waitForTimeout(700)
  return true
}

async function clickUseAnotherProfile(page: Page): Promise<boolean> {
  const action = await findUseAnotherProfile(page)
  if (!action) return false
  try {
    await action.scrollIntoViewIfNeeded().catch(() => undefined)
    await action.click({ timeout: 15_000 })
  } catch {
    return false
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined)
  await page.waitForTimeout(500)
  return true
}

async function submitLogin(page: Page, identifier: string, password: string): Promise<void> {
  const emailInput = loginIdentifierInput(page)
  const passwordInput = loginPasswordInput(page)
  if (!await emailInput.isVisible().catch(() => false) || !await passwordInput.isVisible().catch(() => false)) {
    throw new Error('Không tìm thấy form đăng nhập Facebook.')
  }

  await emailInput.fill(identifier)
  await passwordInput.fill(password)

  const loginButton = await firstVisible([
    page.locator('button[name="login"]:visible').first(),
    page.locator('[data-testid="royal_login_button"]:visible').first(),
    page.getByRole('button', { name: LOGIN_ACTION_PATTERN }).first(),
    page.locator('input[name="login"][type="submit"]:visible').first(),
    page.locator('button[type="submit"]:visible').first()
  ])

  if (loginButton) {
    try {
      await loginButton.scrollIntoViewIfNeeded().catch(() => undefined)
      await loginButton.click({ timeout: 15_000 })
    } catch {
      await passwordInput.press('Enter')
    }
  } else {
    await passwordInput.press('Enter')
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined)
  await page.waitForTimeout(1_000)
}

async function submitPasswordOnly(page: Page, password: string): Promise<void> {
  const passwordInput = loginPasswordInput(page)
  if (!await passwordInput.isVisible().catch(() => false)) {
    throw new Error('Không tìm thấy ô password của saved profile Facebook.')
  }
  await passwordInput.fill(password)

  const submit = await firstVisible([
    page.getByRole('button', { name: PASSWORD_SUBMIT_PATTERN }).first(),
    page.locator('button[type="submit"]:visible').first(),
    page.locator('input[type="submit"]:visible').first()
  ])
  if (submit) {
    try {
      await submit.scrollIntoViewIfNeeded().catch(() => undefined)
      await submit.click({ timeout: 15_000 })
    } catch {
      await passwordInput.press('Enter')
    }
  } else {
    await passwordInput.press('Enter')
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined)
  await page.waitForTimeout(800)
}

async function waitForDifferentTwoFactorCode(page: Page, secret: string, previousCode: string): Promise<void> {
  if (isDirectTwoFactorCode(secret)) return
  while (resolveTwoFactorCode(secret, Date.now()) === previousCode && await isTwoFactorSurfaceActive(page)) {
    await page.waitForTimeout(250)
  }
}

async function submitTotp(
  page: Page,
  secret: string,
  accountId: number,
  attempt: number,
  maxAttempts: number
): Promise<TwoFactorSubmitResult> {
  const attemptDetail = `attempt=${attempt}/${maxAttempts}`
  twoFactorDiagnostic(accountId, 'input_wait_start', attemptDetail)
  let input = await waitForTwoFactorInputReady(page)
  if (!input) {
    twoFactorDiagnostic(accountId, 'input_unavailable', attemptDetail)
    return { submitted: false, code: null }
  }
  twoFactorDiagnostic(accountId, 'input_ready', attemptDetail)

  const freshnessWait = twoFactorCodeFreshnessWaitMs(secret)
  if (freshnessWait > 0) {
    twoFactorDiagnostic(accountId, 'freshness_wait_start', `${attemptDetail} waitMs=${freshnessWait}`)
    await page.waitForTimeout(freshnessWait)
    input = await waitForTwoFactorInputReady(page, 4_000)
    if (!input) {
      twoFactorDiagnostic(accountId, 'input_lost_after_freshness_wait', attemptDetail)
      return { submitted: false, code: null }
    }
    twoFactorDiagnostic(accountId, 'freshness_wait_done', attemptDetail)
  }

  const code = resolveTwoFactorCode(secret, Date.now())
  twoFactorDiagnostic(accountId, 'code_generated', `${attemptDetail} credential=${twoFactorCredentialKind(secret)}`)
  try {
    await input.fill(code)
    twoFactorDiagnostic(accountId, 'input_filled', attemptDetail)
  } catch {
    twoFactorDiagnostic(accountId, 'fill_retry', attemptDetail)
    input = await waitForTwoFactorInputReady(page, 4_000)
    if (!input) {
      twoFactorDiagnostic(accountId, 'input_unavailable_on_fill_retry', attemptDetail)
      return { submitted: false, code: null }
    }
    await input.fill(code)
    twoFactorDiagnostic(accountId, 'input_filled', `${attemptDetail} retry=1`)
  }

  twoFactorDiagnostic(accountId, 'submit_wait_start', attemptDetail)
  const submit = await findTwoFactorSubmit(page)
  let submitted = false
  if (submit) {
    twoFactorDiagnostic(accountId, 'submit_ready', attemptDetail)
    await submit.scrollIntoViewIfNeeded().catch(() => undefined)
    submitted = await submit.click({ timeout: 5_000 }).then(() => true).catch(() => false)
    twoFactorDiagnostic(accountId, 'submit_click', `${attemptDetail} success=${submitted}`)
    if (!submitted) {
      submitted = await domClick(submit)
      twoFactorDiagnostic(accountId, 'submit_dom_click', `${attemptDetail} success=${submitted}`)
    }
  } else {
    twoFactorDiagnostic(accountId, 'submit_not_found', `${attemptDetail} fallback=enter`)
  }

  if (!submitted) {
    submitted = await input.press('Enter').then(() => true).catch(() => false)
    twoFactorDiagnostic(accountId, 'submit_enter', `${attemptDetail} success=${submitted}`)
  }
  if (!submitted) {
    twoFactorDiagnostic(accountId, 'submit_failed', attemptDetail)
    return { submitted: false, code }
  }

  twoFactorDiagnostic(accountId, 'submit_sent', attemptDetail)
  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined)
  return { submitted: true, code }
}

function needsLoginResult(accountId: number, reason: Exclude<FacebookSessionReason, 'valid'>, message: string): FacebookSessionResult {
  return {
    accountId,
    status: 'needs_login',
    reason,
    cookie: null,
    cookieStatus: 'needs_login',
    lastCookieCheck: Date.now(),
    message
  }
}

async function verifiedSuccessResult(
  account: FacebookSessionAccount,
  context: BrowserContext,
  message: string
): Promise<FacebookSessionResult> {
  const actualUserId = await currentFacebookUserId(context).catch(() => null)
  if (!facebookUserIdMatchesExpected(actualUserId, account.uid)) {
    const detail = actualUserId ? `UID ${actualUserId}` : 'không có c_user'
    return needsLoginResult(
      account.id,
      'login_failed',
      `Facebook đang ở ${detail}, không khớp account UID ${account.uid}; giữ browser để người vận hành kiểm tra.`
    )
  }
  return {
    accountId: account.id,
    status: 'valid',
    reason: 'valid',
    cookie: await serializeFacebookCookies(context),
    cookieStatus: 'valid',
    lastCookieCheck: Date.now(),
    message
  }
}

async function completeTwoFactor(
  context: BrowserContext,
  page: Page,
  account: FacebookSessionAccount,
  successMessage: string
): Promise<FacebookSessionResult> {
  const secret = account.twoFactorSecret?.trim()
  if (!secret) {
    twoFactorDiagnostic(account.id, 'missing_credential')
    return needsLoginResult(account.id, 'two_factor_missing', 'Facebook yêu cầu mã 2FA nhưng account chưa có dữ liệu 2FA.')
  }

  const maxAttempts = isDirectTwoFactorCode(secret) ? 1 : TWO_FACTOR_MAX_ATTEMPTS
  const credentialKind = twoFactorCredentialKind(secret)
  twoFactorDiagnostic(account.id, 'handler_start', `credential=${credentialKind} maxAttempts=${maxAttempts}`)
  let previousCode: string | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptDetail = `attempt=${attempt}/${maxAttempts}`
    twoFactorDiagnostic(account.id, 'attempt_start', attemptDetail)
    if (previousCode) {
      twoFactorDiagnostic(account.id, 'fresh_code_wait_start', attemptDetail)
      await waitForDifferentTwoFactorCode(page, secret, previousCode)
      twoFactorDiagnostic(account.id, 'fresh_code_wait_done', attemptDetail)
    }
    if (!await isTwoFactorSurfaceActive(page)) {
      const gate = await inspectFacebookSessionGate(context, page)
      twoFactorDiagnostic(account.id, 'surface_inactive', `${attemptDetail} gate=${gate}`)
      if (gate === 'valid') return verifiedSuccessResult(account, context, successMessage)
      if (gate === 'manual_verification') {
        return needsLoginResult(account.id, 'checkpoint', 'Facebook yêu cầu checkpoint/xác minh danh tính sau 2FA; cần xử lý thủ công.')
      }
      return needsLoginResult(account.id, 'two_factor_failed', 'Facebook đã rời màn 2FA nhưng chưa tạo session hợp lệ; giữ account hiện tại để kiểm tra.')
    }

    let submitted: TwoFactorSubmitResult
    try {
      submitted = await submitTotp(page, secret, account.id, attempt, maxAttempts)
    } catch (error) {
      twoFactorDiagnostic(account.id, 'attempt_exception', `${attemptDetail} error=${error instanceof Error ? error.name : 'unknown'}`)
      return needsLoginResult(account.id, 'two_factor_failed', 'Không thể tạo/nhập/gửi mã 2FA từ dữ liệu 2FA của account.')
    }
    if (!submitted.submitted || !submitted.code) {
      twoFactorDiagnostic(account.id, 'attempt_not_submitted', attemptDetail)
      return needsLoginResult(account.id, 'two_factor_failed', 'Màn 2FA đã được nhận diện nhưng chưa tìm được ô Code/nút Continue ở trạng thái sẵn sàng; giữ account hiện tại để kiểm tra.')
    }

    previousCode = submitted.code
    twoFactorDiagnostic(account.id, 'outcome_wait_start', attemptDetail)
    const gate = await waitForTwoFactorOutcome(context, page)
    twoFactorDiagnostic(account.id, 'outcome', `${attemptDetail} gate=${gate}`)
    if (gate === 'valid') return verifiedSuccessResult(account, context, successMessage)
    if (gate === 'manual_verification') {
      return needsLoginResult(account.id, 'checkpoint', 'Facebook yêu cầu checkpoint/xác minh danh tính sau 2FA; cần xử lý thủ công.')
    }

    const stillTwoFactor = gate === 'two_factor' || await isTwoFactorSurfaceActive(page)
    if (!stillTwoFactor) {
      twoFactorDiagnostic(account.id, 'surface_left_without_valid_session', `${attemptDetail} gate=${gate}`)
      return needsLoginResult(account.id, 'two_factor_failed', 'Facebook đã phản hồi sau 2FA nhưng chưa tạo session hợp lệ; giữ account hiện tại để kiểm tra.')
    }
    if (attempt < maxAttempts) {
      twoFactorDiagnostic(account.id, 'retry_pending', `nextAttempt=${attempt + 1}/${maxAttempts}`)
    }
  }

  twoFactorDiagnostic(account.id, 'handler_exhausted', `credential=${credentialKind} attempts=${maxAttempts}`)
  return needsLoginResult(account.id, 'two_factor_failed', 'Đã thử mã 2FA tối đa 2 lần nhưng Facebook vẫn giữ màn 2FA; tạm dừng tại account hiện tại để kiểm tra thủ công.')
}

async function resolveAuthenticatedGate(
  context: BrowserContext,
  page: Page,
  account: FacebookSessionAccount,
  gate: FacebookSessionGate,
  successMessage: string
): Promise<FacebookSessionResult | null> {
  if (gate === 'valid') return verifiedSuccessResult(account, context, successMessage)
  if (gate === 'two_factor' || (gate === 'unknown' && isTwoFactorVerificationUrl(page.url()))) {
    return completeTwoFactor(context, page, account, successMessage)
  }
  if (gate === 'manual_verification') {
    return needsLoginResult(account.id, 'checkpoint', 'Facebook yêu cầu checkpoint/xác minh danh tính; cần xử lý thủ công trên browser đang mở.')
  }
  return null
}

export async function validateFacebookSession(context: BrowserContext, page: Page): Promise<FacebookSessionValidation> {
  const gate = await inspectFacebookSessionGate(context, page)
  if (gate === 'valid') return { state: 'valid', message: 'Session Facebook hợp lệ.' }
  if (gate === 'manual_verification') {
    return { state: 'verification_required', message: 'Facebook yêu cầu checkpoint/xác minh danh tính; cần xử lý thủ công.' }
  }
  if (gate === 'two_factor' || isTwoFactorVerificationUrl(page.url())) {
    return { state: 'needs_login', message: 'Facebook đang yêu cầu mã 2FA; cần hoàn tất luồng đăng nhập trước khi tiếp tục.' }
  }
  return { state: 'needs_login', message: 'Session Facebook đã hết hoặc chưa đăng nhập.' }
}

async function navigateFacebookHome(page: Page): Promise<void> {
  await page.goto('https://www.facebook.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000
  })
  await page.waitForTimeout(700)
}

export async function bootstrapFacebookSession(
  context: BrowserContext,
  page: Page,
  account: FacebookSessionAccount,
  locale: FacebookLocale = 'auto'
): Promise<FacebookSessionResult> {
  const storedCookies = canUseStoredFacebookCookies(account.cookie, account.uid)
    ? parseFacebookCookies(account.cookie)
    : []
  const existingUserId = await currentFacebookUserId(context).catch(() => null)
  let storedCookieApplied = false

  // A stored cookie whose c_user matches this numeric account is preferred over a
  // missing or mismatched persistent c_user. This keeps cookie restore ahead of
  // interactive login without trusting a cookie belonging to another UID.
  if (!facebookUserIdMatchesExpected(existingUserId, account.uid) && storedCookies.length > 0) {
    await context.addCookies(storedCookies).catch(() => undefined)
    storedCookieApplied = true
  }
  await applyFacebookLocale(context, locale).catch(() => undefined)
  await navigateFacebookHome(page)

  let gate = await inspectFacebookSessionGate(context, page)
  const initialResolved = await resolveAuthenticatedGate(
    context,
    page,
    account,
    gate,
    'Session Facebook hợp lệ từ persistent profile/cookie.'
  )
  if (initialResolved) return initialResolved

  if (!storedCookieApplied && storedCookies.length > 0) {
    await context.addCookies(storedCookies).catch(() => undefined)
    await navigateFacebookHome(page)
    gate = await inspectFacebookSessionGate(context, page)
    const cookieResolved = await resolveAuthenticatedGate(
      context,
      page,
      account,
      gate,
      'Đã khôi phục session Facebook bằng cookie đã lưu.'
    )
    if (cookieResolved) return cookieResolved
  }

  if (gate === 'unknown') {
    gate = await openExplicitFacebookLoginSurface(context, page)
    const explicitResolved = await resolveAuthenticatedGate(
      context,
      page,
      account,
      gate,
      'Facebook đã khôi phục session khi mở trang đăng nhập.'
    )
    if (explicitResolved) return explicitResolved
  }

  if (gate === 'saved_profile') {
    const continued = await clickSavedProfileContinue(page)
    if (continued) {
      gate = await waitForPostLoginGate(context, page)
      const continuedResolved = await resolveAuthenticatedGate(
        context,
        page,
        account,
        gate,
        'Đã đăng nhập bằng saved profile Facebook và xác minh đúng account.'
      )
      if (continuedResolved) return continuedResolved
    }

    if (gate === 'saved_profile' || gate === 'unknown') {
      if (await clickUseAnotherProfile(page)) {
        gate = await waitForLoginSurfaceGate(context, page)
        const fallbackResolved = await resolveAuthenticatedGate(
          context,
          page,
          account,
          gate,
          'Facebook đã khôi phục session sau khi chọn profile đăng nhập khác.'
        )
        if (fallbackResolved) return fallbackResolved
      }
    }
  }

  const identifier = account.username?.trim() || account.uid.trim()
  const password = account.password?.trim()

  if (gate === 'password_only') {
    if (!password) {
      return needsLoginResult(account.id, 'login_required', 'Saved profile Facebook yêu cầu password nhưng account chưa có password để tự đăng nhập.')
    }
    try {
      await submitPasswordOnly(page, password)
    } catch (error) {
      return needsLoginResult(account.id, 'login_failed', error instanceof Error ? error.message : String(error))
    }

    gate = await waitForPasswordOnlyTransition(context, page)
    const passwordOnlyResolved = await resolveAuthenticatedGate(
      context,
      page,
      account,
      gate,
      'Đăng nhập saved profile Facebook bằng password thành công.'
    )
    if (passwordOnlyResolved) return passwordOnlyResolved
    if (gate === 'unknown') {
      return needsLoginResult(account.id, 'unknown', 'Facebook chưa hoàn tất chuyển trạng thái sau khi gửi password saved profile; browser được giữ mở để kiểm tra thủ công.')
    }
  }

  if (!identifier || !password) {
    return needsLoginResult(account.id, 'login_required', 'Cookie/saved profile không khôi phục được session và account thiếu UID/UserName hoặc password để tự đăng nhập.')
  }

  if (gate !== 'login') {
    return needsLoginResult(account.id, 'unknown', 'Facebook chưa hiển thị được form đăng nhập sau khi thử cookie/saved profile; browser được giữ mở để xử lý thủ công.')
  }

  try {
    await submitLogin(page, identifier, password)
  } catch (error) {
    return needsLoginResult(account.id, 'login_failed', error instanceof Error ? error.message : String(error))
  }

  gate = await waitForPostLoginGate(context, page)
  if (gate === 'valid') {
    return verifiedSuccessResult(account, context, 'Đăng nhập Facebook bằng UID/UserName + password thành công.')
  }
  if (gate === 'two_factor') {
    return completeTwoFactor(context, page, account, 'Đăng nhập Facebook + 2FA thành công.')
  }
  if (gate === 'manual_verification') {
    return needsLoginResult(account.id, 'checkpoint', 'Facebook yêu cầu checkpoint/xác minh danh tính sau login; cần xử lý thủ công.')
  }
  if (gate === 'login') {
    return needsLoginResult(account.id, 'login_failed', 'Facebook vẫn hiển thị màn đăng nhập; kiểm tra UID/UserName, password hoặc thông báo trên browser.')
  }
  if (gate === 'password_only') {
    return needsLoginResult(account.id, 'login_failed', 'Facebook chuyển sang màn password-only sau login nhưng chưa tạo session hợp lệ; cần kiểm tra trên browser.')
  }
  return needsLoginResult(account.id, 'unknown', 'Facebook chưa tạo session hợp lệ sau login; browser được giữ mở để kiểm tra thủ công.')
}
