import type { BrowserContext, Page } from 'playwright-core'

export type FacebookAccessBlock = 'login_required' | 'verification_required' | null

// Keep text fallback limited to account-authentication surfaces. A normal Page/admin UI can
// contain generic words such as "xác minh" (verification/verified) without being a checkpoint.
// Hard checkpoint/login routes remain authoritative in classifyFacebookUrl().
const FACEBOOK_VERIFICATION_TEXT_PATTERN = /checkpoint|confirm your identity|verify your identity|xác minh (?:danh tính|tài khoản)(?: của bạn)?|phê duyệt đăng nhập|authentication code|your account (?:has been|was|is) locked|we locked your account|your account (?:has been|was) disabled|we disabled your account|tài khoản (?:của bạn )?(?:đã )?bị khóa|tài khoản (?:của bạn )?(?:đã )?bị vô hiệu hóa|chúng tôi (?:đã )?(?:khóa|vô hiệu hóa) tài khoản/i

export function classifyFacebookUrl(url: string): FacebookAccessBlock {
  const normalized = url.toLowerCase()
  if (normalized.includes('/checkpoint/') || normalized.includes('/two_step_verification/') || normalized.includes('/recover/')) {
    return 'verification_required'
  }
  if (normalized.includes('/login/')) {
    return 'login_required'
  }
  return null
}

export function classifyFacebookAccessText(text: string): FacebookAccessBlock {
  FACEBOOK_VERIFICATION_TEXT_PATTERN.lastIndex = 0
  return FACEBOOK_VERIFICATION_TEXT_PATTERN.test(text) ? 'verification_required' : null
}

export async function detectFacebookAccessBlock(page: Page): Promise<FacebookAccessBlock> {
  const byUrl = classifyFacebookUrl(page.url())
  if (byUrl) return byUrl

  const loginForm = page.locator('input[name="email"], input[name="pass"]').first()
  if (await loginForm.isVisible().catch(() => false)) {
    return 'login_required'
  }

  const verificationText = page.getByText(FACEBOOK_VERIFICATION_TEXT_PATTERN).first()
  if (await verificationText.isVisible().catch(() => false)) {
    return 'verification_required'
  }

  return null
}

export async function activeFacebookProfileId(context: BrowserContext): Promise<string | null> {
  const cookies = await context.cookies('https://www.facebook.com')
  const actingProfile = cookies.find((cookie) => cookie.name === 'i_user')?.value
  return actingProfile?.trim() || null
}
