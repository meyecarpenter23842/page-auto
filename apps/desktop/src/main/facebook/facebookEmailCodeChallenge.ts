import type { Locator, Page } from 'playwright-core'
import {
  FACEBOOK_EMAIL_CODE_TIMEOUT_MS,
  type EmailCodeFailureStatus,
  type EmailCodeProvider,
  type EmailCodeRequest
} from '../../shared/emailCode'

const EMAIL_CHALLENGE_PROMPT = /check (?:your )?email|sent (?:you )?(?:an? )?(?:security |verification |login )?code.*email|code (?:we )?(?:sent|emailed).*email|enter.*code.*email|mã.*(?:gửi|đã gửi).*(?:email|e-mail)|kiểm tra.*(?:email|e-mail)|mã.*(?:email|e-mail)/i
const EMAIL_SUBMIT_PATTERN = /^(continue|tiếp tục|confirm|xác nhận|submit|gửi|next|tiếp theo)$/i
const CHALLENGE_OBSERVED_TOLERANCE_MS = 2 * 60_000
const OUTCOME_TIMEOUT_MS = 15_000

export type FacebookEmailCodeChallengeStatus = 'not_applicable' | 'success' | EmailCodeFailureStatus | 'email_code_failed'

export interface FacebookEmailCodeChallengeResult {
  status: FacebookEmailCodeChallengeStatus
  message: string
}

export interface FacebookEmailChallengeSurfaceInput {
  url: string
  promptVisible: boolean
  inputVisible: boolean
}

export function classifyFacebookEmailChallengeSurface(input: FacebookEmailChallengeSurfaceInput): boolean {
  if (!input.inputVisible) return false
  return input.url.toLowerCase().includes('/confirmemail') || input.promptVisible
}

export function facebookEmailCodeRequest(accountId: number, observedAt = Date.now()): EmailCodeRequest {
  return {
    accountId,
    consumer: 'facebook_login',
    notBefore: observedAt - CHALLENGE_OBSERVED_TOLERANCE_MS,
    timeoutMs: FACEBOOK_EMAIL_CODE_TIMEOUT_MS
  }
}

async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  return null
}

async function findEmailCodeInput(page: Page): Promise<Locator | null> {
  return firstVisible([
    page.locator('input[autocomplete="one-time-code"]').first(),
    page.locator('input[name*="code" i]').first(),
    page.locator('input[id*="code" i]').first(),
    page.locator('input[placeholder*="code" i]').first(),
    page.locator('input[aria-label*="code" i]').first(),
    page.locator('input[inputmode="numeric"]').first(),
    page.locator('input[type="tel"]').first()
  ])
}

async function hasEmailChallengePrompt(page: Page): Promise<boolean> {
  return page.getByText(EMAIL_CHALLENGE_PROMPT).first().isVisible().catch(() => false)
}

export async function isFacebookEmailCodeChallenge(page: Page): Promise<boolean> {
  const [input, promptVisible] = await Promise.all([
    findEmailCodeInput(page),
    hasEmailChallengePrompt(page)
  ])
  return classifyFacebookEmailChallengeSurface({
    url: page.url(),
    promptVisible,
    inputVisible: Boolean(input)
  })
}

async function submitEmailCode(page: Page, input: Locator, code: string): Promise<boolean> {
  try {
    await input.fill(code)
  } catch {
    return false
  }

  const submit = await firstVisible([
    page.getByRole('button', { name: EMAIL_SUBMIT_PATTERN }).first(),
    page.getByRole('link', { name: EMAIL_SUBMIT_PATTERN }).first(),
    page.locator('button[type="submit"]:visible').first(),
    page.locator('input[type="submit"]:visible').first()
  ])
  if (submit) {
    const clicked = await submit.click({ timeout: 5_000 }).then(() => true).catch(() => false)
    if (clicked) return true
  }
  return input.press('Enter').then(() => true).catch(() => false)
}

export async function completeFacebookEmailCodeChallenge(
  page: Page,
  accountId: number,
  provider: EmailCodeProvider | null,
  observedAt = Date.now()
): Promise<FacebookEmailCodeChallengeResult> {
  if (!await isFacebookEmailCodeChallenge(page)) {
    return { status: 'not_applicable', message: 'Facebook checkpoint hiện tại không phải challenge mã Email được hỗ trợ.' }
  }
  if (!provider) {
    return { status: 'email_auth_missing', message: 'Facebook cần mã Email nhưng Email Support Service chưa sẵn sàng.' }
  }

  const result = await provider.getEmailCode(facebookEmailCodeRequest(accountId, observedAt))
  if (result.status !== 'success' || !result.code) return { status: result.status, message: result.message }

  const input = await findEmailCodeInput(page)
  if (!input) return { status: 'email_code_failed', message: 'Đã nhận mã Email nhưng Facebook không còn ô nhập mã.' }
  if (!await submitEmailCode(page, input, result.code)) {
    return { status: 'email_code_failed', message: 'Đã nhận mã Email nhưng không gửi được mã trên Facebook.' }
  }

  const deadline = Date.now() + OUTCOME_TIMEOUT_MS
  while (Date.now() < deadline) {
    await page.waitForLoadState('domcontentloaded', { timeout: 2_000 }).catch(() => undefined)
    if (!await isFacebookEmailCodeChallenge(page)) {
      return { status: 'success', message: 'Facebook đã nhận mã Email; tiếp tục xác minh session bằng Common Runtime.' }
    }
    await page.waitForTimeout(250)
  }

  return { status: 'email_code_failed', message: 'Facebook vẫn giữ màn nhập mã Email sau khi đã gửi mã; cần kiểm tra thủ công.' }
}
