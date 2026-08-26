import type { BrowserContext, Page } from 'playwright-core'
import {
  facebookUserIdMatchesExpected,
  inspectFacebookSessionGate,
  type FacebookSessionAccount,
  type FacebookSessionResult
} from './facebookSession'

const POST_TWO_FACTOR_SETTLE_ATTEMPTS = 48
const POST_TWO_FACTOR_SETTLE_POLL_MS = 250
const POST_TWO_FACTOR_MESSAGE_PATTERN = /(?:sau|after)\s+2fa/i

export interface PostTwoFactorSettleOptions {
  attempts?: number
  pollMs?: number
}

function postTwoFactorDiagnostic(accountId: number, stage: string, detail = ''): void {
  console.info(`[PAGE-AUTO session] account=${accountId} state=post_2fa stage=${stage}${detail ? ` ${detail}` : ''}`)
}

function isExplicitManualVerificationUrl(url: string): boolean {
  const normalized = url.toLowerCase()
  return normalized.includes('/checkpoint/')
    || normalized.includes('/recover/')
    || normalized.includes('/confirmemail')
    || normalized.includes('/identity/')
}

function shouldSettlePostTwoFactorResult(page: Page, previous: FacebookSessionResult): boolean {
  if (previous.status === 'valid') return false
  if (previous.reason === 'two_factor_failed') return true
  return previous.reason === 'checkpoint'
    && !isExplicitManualVerificationUrl(page.url())
    && POST_TWO_FACTOR_MESSAGE_PATTERN.test(previous.message)
}

function needsLoginResult(
  accountId: number,
  reason: 'checkpoint' | 'login_failed',
  message: string
): FacebookSessionResult {
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

async function facebookCookieSnapshot(context: BrowserContext): Promise<{
  userId: string | null
  serialized: string | null
}> {
  const cookies = await context.cookies('https://www.facebook.com')
  const facebookCookies = cookies.filter((cookie) => cookie.domain.endsWith('facebook.com'))
  return {
    userId: facebookCookies.find((cookie) => cookie.name === 'c_user')?.value?.trim() || null,
    serialized: facebookCookies.length > 0
      ? facebookCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
      : null
  }
}

export async function settleFacebookSessionAfterTwoFactor(
  context: BrowserContext,
  page: Page,
  account: FacebookSessionAccount,
  previous: FacebookSessionResult,
  options: PostTwoFactorSettleOptions = {}
): Promise<FacebookSessionResult> {
  if (!shouldSettlePostTwoFactorResult(page, previous)) return previous

  const attempts = Math.max(1, Math.floor(options.attempts ?? POST_TWO_FACTOR_SETTLE_ATTEMPTS))
  const pollMs = Math.max(0, Math.floor(options.pollMs ?? POST_TWO_FACTOR_SETTLE_POLL_MS))
  postTwoFactorDiagnostic(
    account.id,
    'settle_start',
    `attempts=${attempts} pollMs=${pollMs} previous=${previous.reason}`
  )

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const gate = await inspectFacebookSessionGate(context, page)
    if (isExplicitManualVerificationUrl(page.url())) {
      postTwoFactorDiagnostic(account.id, 'settle_checkpoint', `attempt=${attempt}/${attempts} source=url`)
      return needsLoginResult(
        account.id,
        'checkpoint',
        'Facebook yêu cầu checkpoint/xác minh danh tính sau 2FA; cần xử lý thủ công.'
      )
    }

    const stillTwoFactorUrl = page.url().toLowerCase().includes('/two_step_verification/')
    if (gate === 'two_factor' || stillTwoFactorUrl) {
      postTwoFactorDiagnostic(account.id, 'settle_still_two_factor', `attempt=${attempt}/${attempts}`)
      return previous
    }
    if (gate === 'login' || gate === 'password_only' || gate === 'saved_profile') {
      postTwoFactorDiagnostic(account.id, 'settle_login_surface', `attempt=${attempt}/${attempts} gate=${gate}`)
      return previous
    }

    const snapshot = await facebookCookieSnapshot(context)
    if (snapshot.userId) {
      if (!facebookUserIdMatchesExpected(snapshot.userId, account.uid)) {
        postTwoFactorDiagnostic(account.id, 'settle_uid_mismatch', `attempt=${attempt}/${attempts}`)
        return needsLoginResult(
          account.id,
          'login_failed',
          `Facebook đã tạo session sau 2FA nhưng UID ${snapshot.userId} không khớp account UID ${account.uid}; giữ browser để người vận hành kiểm tra.`
        )
      }

      postTwoFactorDiagnostic(account.id, 'settle_valid', `attempt=${attempt}/${attempts}`)
      return {
        accountId: account.id,
        status: 'valid',
        reason: 'valid',
        cookie: snapshot.serialized,
        cookieStatus: 'valid',
        lastCookieCheck: Date.now(),
        message: 'Đăng nhập Facebook + 2FA thành công; session đã ổn định và xác minh đúng account.'
      }
    }

    if (gate === 'manual_verification') {
      postTwoFactorDiagnostic(account.id, 'settle_text_only_manual', `attempt=${attempt}/${attempts}`)
      if (attempt < attempts) await page.waitForTimeout(pollMs)
      continue
    }

    if (attempt < attempts) await page.waitForTimeout(pollMs)
  }

  postTwoFactorDiagnostic(account.id, 'settle_timeout', `previous=${previous.reason}`)
  return previous
}
