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

export type FacebookSessionGate = 'valid' | 'login' | 'two_factor' | 'manual_verification' | 'unknown'

export interface FacebookSessionResult {
  accountId: number
  status: AccountStatus
  reason: FacebookSessionReason
  cookie: string | null
  cookieStatus: 'valid' | 'needs_login' | 'error'
  lastCookieCheck: number
  message: string
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
}

export interface FacebookSessionValidation {
  state: 'valid' | 'needs_login' | 'verification_required'
  message: string
}

type ContextCookie = FacebookCookieInput

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

export function generateTotp(secret: string, timestampMs = Date.now(), digits = 6): string {
  const key = decodeBase32(extractTotpSecret(secret))
  const counter = Math.floor(timestampMs / 30_000)
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
  if (/^\d{6,8}$/.test(directCode)) return directCode
  return generateTotp(rawSecret, timestampMs, 6)
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

async function isLoginFormVisible(page: Page): Promise<boolean> {
  const email = page.locator('input[name="email"], #email').first()
  const password = page.locator('input[name="pass"], #pass').first()
  return (await email.isVisible().catch(() => false)) || (await password.isVisible().catch(() => false))
}

function isManualVerificationUrl(url: string): boolean {
  const normalized = url.toLowerCase()
  return normalized.includes('/checkpoint/')
    || normalized.includes('/recover/')
    || normalized.includes('/confirmemail')
    || normalized.includes('/identity/')
    || normalized.includes('/two_step_verification/')
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

async function findTwoFactorInput(page: Page): Promise<Locator | null> {
  const approvalsInput = await firstVisible([
    page.locator('input[name="approvals_code"]').first(),
    page.locator('input[name="approvalsCode"]').first()
  ])
  if (approvalsInput) return approvalsInput
  if (!await hasAuthenticatorPrompt(page)) return null

  return firstVisible([
    page.locator('input[name="code"]').first(),
    page.locator('input[autocomplete="one-time-code"]').first(),
    page.locator('input[inputmode="numeric"]').first(),
    page.locator('input[type="tel"]').first()
  ])
}

export function classifyFacebookSessionGate(input: FacebookSessionGateInput): FacebookSessionGate {
  if (input.twoFactorVisible) return 'two_factor'
  if (isManualVerificationUrl(input.url) || input.manualVerificationTextVisible) return 'manual_verification'
  if (input.loginFormVisible || input.url.toLowerCase().includes('/login/')) return 'login'
  if (input.hasUserCookie) return 'valid'
  return 'unknown'
}

export async function inspectFacebookSessionGate(context: BrowserContext, page: Page): Promise<FacebookSessionGate> {
  const [userId, loginFormVisible, twoFactorInput, manualVerificationTextVisible] = await Promise.all([
    currentFacebookUserId(context),
    isLoginFormVisible(page),
    findTwoFactorInput(page),
    hasManualVerificationText(page)
  ])

  return classifyFacebookSessionGate({
    url: page.url(),
    hasUserCookie: Boolean(userId),
    loginFormVisible,
    twoFactorVisible: Boolean(twoFactorInput),
    manualVerificationTextVisible
  })
}

async function waitForPostLoginGate(context: BrowserContext, page: Page, timeoutMs = 12_000): Promise<FacebookSessionGate> {
  const deadline = Date.now() + timeoutMs
  let latest: FacebookSessionGate = 'unknown'
  while (Date.now() < deadline) {
    latest = await inspectFacebookSessionGate(context, page)
    if (latest === 'valid' || latest === 'two_factor' || latest === 'manual_verification') return latest
    await page.waitForTimeout(250)
  }
  return latest
}

async function submitLogin(page: Page, identifier: string, password: string): Promise<void> {
  const emailInput = page.locator('input[name="email"], #email').first()
  const passwordInput = page.locator('input[name="pass"], #pass').first()
  if (!await emailInput.isVisible().catch(() => false) || !await passwordInput.isVisible().catch(() => false)) {
    throw new Error('Không tìm thấy form đăng nhập Facebook.')
  }

  await emailInput.fill(identifier)
  await passwordInput.fill(password)

  const loginButton = await firstVisible([
    page.locator('button[name="login"]:visible').first(),
    page.locator('[data-testid="royal_login_button"]:visible').first(),
    page.getByRole('button', { name: /^(log in|login|đăng nhập)$/i }).first(),
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

async function submitTotp(page: Page, secret: string): Promise<boolean> {
  const input = await findTwoFactorInput(page)
  if (!input) return false
  await input.fill(resolveTwoFactorCode(secret))

  const submit = await firstVisible([
    page.getByRole('button', { name: /continue|tiếp tục|submit|gửi|confirm|xác nhận/i }).first(),
    page.locator('button[type="submit"]:visible').first(),
    page.locator('input[type="submit"]:visible').first()
  ])
  if (submit) {
    await submit.click({ timeout: 15_000 })
  } else {
    await input.press('Enter')
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined)
  await page.waitForTimeout(800)
  return true
}

async function successResult(accountId: number, context: BrowserContext, message: string): Promise<FacebookSessionResult> {
  return {
    accountId,
    status: 'valid',
    reason: 'valid',
    cookie: await serializeFacebookCookies(context),
    cookieStatus: 'valid',
    lastCookieCheck: Date.now(),
    message
  }
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

async function completeTwoFactor(
  context: BrowserContext,
  page: Page,
  account: FacebookSessionAccount,
  successMessage: string
): Promise<FacebookSessionResult> {
  if (!account.twoFactorSecret?.trim()) {
    return needsLoginResult(account.id, 'two_factor_missing', 'Facebook yêu cầu mã 2FA nhưng account chưa có dữ liệu 2FA.')
  }

  try {
    if (!await submitTotp(page, account.twoFactorSecret)) {
      return needsLoginResult(account.id, 'two_factor_failed', 'Không phát hiện được ô nhập mã 2FA để tiếp tục đăng nhập.')
    }
  } catch {
    return needsLoginResult(account.id, 'two_factor_failed', 'Không thể tạo/nhập mã 2FA từ dữ liệu 2FA của account.')
  }

  const gate = await waitForPostLoginGate(context, page)
  if (gate === 'valid') return successResult(account.id, context, successMessage)
  if (gate === 'manual_verification') {
    return needsLoginResult(account.id, 'checkpoint', 'Facebook yêu cầu checkpoint/xác minh danh tính sau 2FA; cần xử lý thủ công.')
  }
  return needsLoginResult(account.id, 'two_factor_failed', 'Đã nhập mã 2FA nhưng Facebook chưa xác nhận session; cần kiểm tra thủ công trên browser.')
}

export async function validateFacebookSession(context: BrowserContext, page: Page): Promise<FacebookSessionValidation> {
  const gate = await inspectFacebookSessionGate(context, page)
  if (gate === 'valid') return { state: 'valid', message: 'Session Facebook hợp lệ.' }
  if (gate === 'manual_verification') {
    return { state: 'verification_required', message: 'Facebook yêu cầu checkpoint/xác minh danh tính; cần xử lý thủ công.' }
  }
  if (gate === 'two_factor') {
    return { state: 'needs_login', message: 'Facebook đang yêu cầu mã 2FA; cần hoàn tất luồng đăng nhập trước khi tiếp tục.' }
  }
  return { state: 'needs_login', message: 'Session Facebook đã hết hoặc chưa đăng nhập.' }
}

export async function bootstrapFacebookSession(
  context: BrowserContext,
  page: Page,
  account: FacebookSessionAccount,
  locale: FacebookLocale = 'auto'
): Promise<FacebookSessionResult> {
  const existingUserId = await currentFacebookUserId(context).catch(() => null)
  if (!existingUserId) {
    const importedCookies = parseFacebookCookies(account.cookie)
    if (importedCookies.length > 0) await context.addCookies(importedCookies).catch(() => undefined)
  }
  await applyFacebookLocale(context, locale).catch(() => undefined)

  await page.goto('https://www.facebook.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000
  })
  await page.waitForTimeout(700)

  let gate = await inspectFacebookSessionGate(context, page)
  if (gate === 'two_factor') {
    return completeTwoFactor(context, page, account, 'Đã xác thực 2FA và session Facebook hợp lệ.')
  }
  if (gate === 'manual_verification') {
    return needsLoginResult(account.id, 'checkpoint', 'Facebook yêu cầu checkpoint/xác minh danh tính; cần xử lý thủ công trên browser đang mở.')
  }
  if (gate === 'valid') {
    return successResult(account.id, context, 'Session Facebook hợp lệ từ persistent profile/cookie.')
  }
  if (gate !== 'login') {
    return needsLoginResult(account.id, 'unknown', 'Facebook chưa xác nhận session; browser được giữ mở để xử lý thủ công.')
  }

  const identifier = account.username?.trim() || account.uid.trim()
  const password = account.password?.trim()
  if (!identifier || !password) {
    return needsLoginResult(account.id, 'login_required', 'Account thiếu UID/UserName hoặc password để tự đăng nhập.')
  }

  try {
    await submitLogin(page, identifier, password)
  } catch (error) {
    return needsLoginResult(account.id, 'login_failed', error instanceof Error ? error.message : String(error))
  }

  gate = await waitForPostLoginGate(context, page)
  if (gate === 'valid') {
    return successResult(account.id, context, 'Đăng nhập Facebook bằng UID/UserName + password thành công.')
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
  return needsLoginResult(account.id, 'unknown', 'Facebook chưa tạo session hợp lệ sau login; kiểm tra thông báo trên browser.')
}