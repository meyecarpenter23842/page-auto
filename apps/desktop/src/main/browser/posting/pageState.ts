import type { BrowserContext, Page } from 'playwright-core'

export type FacebookAccessBlock = 'login_required' | 'verification_required' | null

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

export async function detectFacebookAccessBlock(page: Page): Promise<FacebookAccessBlock> {
  const byUrl = classifyFacebookUrl(page.url())
  if (byUrl) return byUrl

  const loginForm = page.locator('input[name="email"], input[name="pass"]').first()
  if (await loginForm.isVisible().catch(() => false)) {
    return 'login_required'
  }

  const verificationText = page.getByText(/checkpoint|confirm your identity|xác minh|phê duyệt đăng nhập|authentication code/i).first()
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
