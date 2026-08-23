import { createHmac } from 'node:crypto'
import type { BrowserContext, Locator, Page } from 'playwright-core'
import type { AccountStatus } from '../../shared/accounts'

export interface FacebookSessionAccount {
  id: number
  uid: string
  username: string | null
  password: string | null
  cookie: string | null
  twoFactorSecret: string | null
}

export interface FacebookSessionResult {
  accountId: number
  status: AccountStatus
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
}

async function hasManualVerificationText(page: Page): Promise<boolean> {
  const marker = page.getByText(/confirm your identity|xác minh danh tính|phê duyệt đăng nhập|upload.*id|tải.*giấy tờ/i).first()
  return marker.isVisible().catch(() => false)
}

async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  return null
}

async function findTwoFactorInput(page: Page) {
  const candidates = [
    page.locator('input[name="approvals_code"]').first(),
    page.locator('input[name="code"]').first(),
    page.locator('input[autocomplete="one-time-code"]').first(),
    page.locator('input[inputmode="numeric"]').first()
  ]
  return firstVisible(candidates)
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
  await page.waitForTimeout(1_500)
}

async function submitTotp(page: Page, secret: string): Promise<boolean> {
  const input = await findTwoFactorInput(page)
  if (!input) return false
  await input.fill(generateTotp(secret))

  const submit = await firstVisible([
    page.getByRole('button', { name: /continue|tiếp tục|submit|gửi/i }).first(),
    page.locator('button[type="submit"]:visible').first(),
    page.locator('input[type="submit"]:visible').first()
  ])
  if (submit) {
    await submit.click({ timeout: 15_000 })
  } else {
    await input.press('Enter')
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined)
  await page.waitForTimeout(1_200)
  return true
}

async function successResult(accountId: number, context: BrowserContext, message: string): Promise<FacebookSessionResult> {
  return {
    accountId,
    status: 'valid',
    cookie: await serializeFacebookCookies(context),
    cookieStatus: 'valid',
    lastCookieCheck: Date.now(),
    message
  }
}

function needsLoginResult(accountId: number, message: string): FacebookSessionResult {
  return {
    accountId,
    status: 'needs_login',
    cookie: null,
    cookieStatus: 'needs_login',
    lastCookieCheck: Date.now(),
    message
  }
}

export async function bootstrapFacebookSession(
  context: BrowserContext,
  page: Page,
  account: FacebookSessionAccount
): Promise<FacebookSessionResult> {
  const importedCookies = parseFacebookCookies(account.cookie)
  if (importedCookies.length > 0) {
    await context.addCookies(importedCookies).catch(() => undefined)
  }

  await page.goto('https://www.facebook.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000
  })
  await page.waitForTimeout(700)

  if (isManualVerificationUrl(page.url()) || await hasManualVerificationText(page)) {
    return needsLoginResult(account.id, 'Facebook yêu cầu checkpoint/xác minh danh tính; cần xử lý thủ công trên browser đang mở.')
  }

  if (!await isLoginFormVisible(page) && await currentFacebookUserId(context)) {
    return successResult(account.id, context, 'Session Facebook hợp lệ từ persistent profile/cookie.')
  }

  if (!await isLoginFormVisible(page)) {
    const twoFactorInput = await findTwoFactorInput(page)
    if (twoFactorInput && account.twoFactorSecret) {
      await submitTotp(page, account.twoFactorSecret).catch(() => false)
      if (!await isLoginFormVisible(page) && await currentFacebookUserId(context)) {
        return successResult(account.id, context, 'Đã xác thực 2FA và session Facebook hợp lệ.')
      }
    }
    return needsLoginResult(account.id, 'Facebook chưa xác nhận session; browser được giữ mở để xử lý thủ công.')
  }

  const identifier = account.username?.trim() || account.uid.trim()
  const password = account.password?.trim()
  if (!identifier || !password) {
    return needsLoginResult(account.id, 'Account thiếu UID/UserName hoặc password để tự đăng nhập.')
  }

  try {
    await submitLogin(page, identifier, password)
  } catch (error) {
    return needsLoginResult(account.id, error instanceof Error ? error.message : String(error))
  }

  if (isManualVerificationUrl(page.url()) || await hasManualVerificationText(page)) {
    return needsLoginResult(account.id, 'Facebook yêu cầu checkpoint/xác minh danh tính sau login; cần xử lý thủ công.')
  }

  if (!await isLoginFormVisible(page) && await currentFacebookUserId(context)) {
    return successResult(account.id, context, 'Đăng nhập Facebook bằng UID/UserName + password thành công.')
  }

  const twoFactorInput = await findTwoFactorInput(page)
  if (twoFactorInput) {
    if (!account.twoFactorSecret) {
      return needsLoginResult(account.id, 'Facebook yêu cầu mã 2FA nhưng account chưa có 2FA secret.')
    }

    const submitted = await submitTotp(page, account.twoFactorSecret).catch(() => false)
    if (submitted && !await isLoginFormVisible(page) && await currentFacebookUserId(context)) {
      return successResult(account.id, context, 'Đăng nhập Facebook + 2FA thành công.')
    }

    return needsLoginResult(account.id, 'Đã thử mã 2FA nhưng Facebook còn yêu cầu thao tác/xác minh thêm; cần xử lý thủ công.')
  }

  return needsLoginResult(account.id, 'Facebook chưa tạo session hợp lệ sau login; kiểm tra thông báo trên browser.')
}
