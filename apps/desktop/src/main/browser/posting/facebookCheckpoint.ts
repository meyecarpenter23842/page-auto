import type { Page } from 'playwright-core'
import type { FacebookCommonChallengeType } from '../../../shared/facebookCheckpoint'
import type { PostingCheckpointKind } from '../../../shared/posting'

export const FACEBOOK_CHECKPOINT_CLASSIFY_TIMEOUT_MS = 10_000
const CHECKPOINT_POLL_MS = 250
const KNOWN_CHECKPOINTS = ['282', '956'] as const
const DISABLED_PATTERN = /(?:your account (?:has been|was) disabled|we disabled your account|account disabled|tài khoản (?:của bạn )?(?:đã )?bị vô hiệu hóa|chúng tôi (?:đã )?vô hiệu hóa tài khoản)/i
const PURPLE_LOCK_PATTERN = /(?:your account (?:has been|was|is) locked|we locked your account|account locked|tài khoản (?:của bạn )?(?:đã )?bị khóa|chúng tôi (?:đã )?khóa tài khoản)/i
const EMAIL_PROMPT = /check (?:your )?email|sent.*code.*email|code.*(?:sent|emailed).*email|mã.*(?:email|e-mail)|kiểm tra.*(?:email|e-mail)/i
const TOTP_PROMPT = /two[- ]factor|authentication app|authenticator|login code|security code|mã xác thực|mã đăng nhập|xác thực hai bước/i
const IDENTITY_PROMPT = /confirm your identity|verify your identity|identity verification|xác minh danh tính|xác nhận danh tính/i
const SECURITY_REVIEW_PROMPT = /security check|security review|secure your account|suspicious activity|unusual activity|kiểm tra bảo mật|xem xét bảo mật/i

function knownCheckpointSuffix(value: string): '282' | '956' | null {
  const normalized = value.trim().toLowerCase()
  for (const code of KNOWN_CHECKPOINTS) {
    if (normalized === code || normalized.endsWith(code)) return code
  }
  return null
}

export function facebookCheckpointKindFromUrl(rawUrl: string): PostingCheckpointKind | null {
  try {
    const parsed = new URL(rawUrl)
    const segments = parsed.pathname.split('/').filter(Boolean)
    const checkpointIndex = segments.findIndex((segment) => segment.toLowerCase() === 'checkpoint')
    if (checkpointIndex < 0) return null

    const pathId = segments[checkpointIndex + 1] ?? ''
    const pathKind = knownCheckpointSuffix(pathId)
    if (pathKind) return pathKind

    for (const key of ['checkpoint_code', 'checkpoint_type', 'checkpoint', 'cp']) {
      const value = parsed.searchParams.get(key)
      if (!value) continue
      const queryKind = knownCheckpointSuffix(value)
      if (queryKind) return queryKind
    }
    return 'unknown'
  } catch {
    return null
  }
}

export function facebookCheckpointKindFromText(text: string): '282' | '956' | null {
  const value = text.match(/\b(?:checkpoint|check\s*point|cp)\s*[:#-]?\s*(282|956)\b/i)?.[1]
  return value === '282' || value === '956' ? value : null
}

export function facebookRestrictionKindFromText(
  text: string,
  urlKind: PostingCheckpointKind | null = null
): '956_purple_lock' | 'disabled' | null {
  if (DISABLED_PATTERN.test(text)) return 'disabled'
  if (PURPLE_LOCK_PATTERN.test(text) && (urlKind === '956' || urlKind === 'unknown' || urlKind === null)) {
    return '956_purple_lock'
  }
  return null
}

export function facebookCheckpointKindLabel(kind: PostingCheckpointKind): string {
  if (kind === '282') return 'checkpoint 282'
  if (kind === '956') return 'checkpoint 956'
  if (kind === '956_purple_lock') return 'checkpoint 956 dạng khóa tím'
  if (kind === 'disabled') return 'tài khoản vô hiệu hóa'
  return 'checkpoint chưa xác định'
}

export function withFacebookCheckpointKind(message: string, kind: PostingCheckpointKind | null | undefined): string {
  if (!kind) return message
  return `${message} Phân loại: ${facebookCheckpointKindLabel(kind)}.`
}

export interface FacebookCommonChallengeSignals {
  url: string
  bodyText: string
  codeInputVisible: boolean
  passwordInputVisible: boolean
  loginControlVisible: boolean
}

export interface FacebookCommonChallengeClassification {
  type: FacebookCommonChallengeType
  checkpointKind?: PostingCheckpointKind
}

export function classifyFacebookCommonChallengeSignals(
  signals: FacebookCommonChallengeSignals
): FacebookCommonChallengeClassification {
  const urlKind = facebookCheckpointKindFromUrl(signals.url)
  const restrictionKind = facebookRestrictionKindFromText(signals.bodyText, urlKind)
  const textKind = facebookCheckpointKindFromText(signals.bodyText)
  const checkpointKind: PostingCheckpointKind | undefined = restrictionKind
    ?? (urlKind === 'unknown' ? (textKind ?? urlKind) : (urlKind ?? textKind ?? undefined))
  const url = signals.url.toLowerCase()
  const text = signals.bodyText

  if (restrictionKind) return { type: 'security_review_required', checkpointKind: restrictionKind }

  if (signals.codeInputVisible && EMAIL_PROMPT.test(text)) {
    return { type: 'email_code_challenge', ...(checkpointKind ? { checkpointKind } : {}) }
  }

  if (signals.codeInputVisible && (TOTP_PROMPT.test(text) || url.includes('two_factor') || url.includes('two_step'))) {
    return { type: 'totp_2fa_challenge', ...(checkpointKind ? { checkpointKind } : {}) }
  }

  if (IDENTITY_PROMPT.test(text)) {
    return { type: 'identity_verification_required', ...(checkpointKind ? { checkpointKind } : {}) }
  }

  if (SECURITY_REVIEW_PROMPT.test(text)) {
    return { type: 'security_review_required', ...(checkpointKind ? { checkpointKind } : {}) }
  }

  if (signals.passwordInputVisible || signals.loginControlVisible || url.includes('/login') || url.includes('login_attempt')) {
    return { type: 'login_reauth', ...(checkpointKind ? { checkpointKind } : {}) }
  }

  if (checkpointKind) return { type: 'unsupported_checkpoint', checkpointKind }
  return { type: 'checkpoint_cleared' }
}

async function visible(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().isVisible().catch(() => false)
}

export async function inspectFacebookCommonChallenge(page: Page): Promise<FacebookCommonChallengeClassification> {
  const [bodyText, codeInputVisible, passwordInputVisible, loginControlVisible] = await Promise.all([
    page.locator('body').innerText({ timeout: 1_000 }).catch(() => ''),
    visible(page, 'input[autocomplete="one-time-code"], input[name*="code" i], input[id*="code" i], input[inputmode="numeric"], input[type="tel"]'),
    visible(page, 'input[type="password"]'),
    visible(page, 'button[type="submit"], input[type="submit"], [role="button"]')
  ])
  return classifyFacebookCommonChallengeSignals({
    url: page.url(),
    bodyText,
    codeInputVisible,
    passwordInputVisible,
    loginControlVisible
  })
}

async function inspectCheckpointKind(page: Page): Promise<PostingCheckpointKind | null> {
  const urlKind = facebookCheckpointKindFromUrl(page.url())
  const bodyText = await page.locator('body').innerText({ timeout: 1_000 }).catch(() => '')
  const restrictionKind = facebookRestrictionKindFromText(bodyText, urlKind)
  if (restrictionKind) return restrictionKind
  if (urlKind === '282' || urlKind === '956' || urlKind === null) return urlKind
  return facebookCheckpointKindFromText(bodyText) ?? 'unknown'
}

function isResolvedKind(kind: PostingCheckpointKind | null): boolean {
  return kind === '282'
    || kind === '956'
    || kind === '956_purple_lock'
    || kind === 'disabled'
    || kind === null
}

/**
 * Observe an already-detected Facebook checkpoint for at most 10 seconds.
 * Time is only a classification window: known states are determined from URL/DOM,
 * never inferred merely because the timeout elapsed.
 */
export async function detectFacebookCheckpointKind(
  page: Page,
  timeoutMs = FACEBOOK_CHECKPOINT_CLASSIFY_TIMEOUT_MS
): Promise<PostingCheckpointKind | null> {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  let latest = await inspectCheckpointKind(page)
  if (isResolvedKind(latest)) return latest

  while (Date.now() < deadline) {
    await page.waitForTimeout(Math.min(CHECKPOINT_POLL_MS, Math.max(1, deadline - Date.now())))
    latest = await inspectCheckpointKind(page)
    if (isResolvedKind(latest)) return latest
  }
  return latest
}
