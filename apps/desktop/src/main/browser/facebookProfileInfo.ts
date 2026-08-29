import type { Page } from 'playwright-core'

export function normalizeFacebookProfileName(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!normalized) return null

  const withoutFacebookSuffix = normalized.replace(/\s*[|\-–—]\s*Facebook\s*$/i, '').trim()
  if (!withoutFacebookSuffix) return null

  const generic = /^(facebook|log in|login|đăng nhập|home|trang chủ)$/i
  if (generic.test(withoutFacebookSuffix)) return null

  // Facebook tab titles can be notification counters such as "(20+) Facebook".
  // Those are browser chrome/page-title state, never an account display name.
  if (/^\(\d+\+?\)\s*facebook$/i.test(normalized)) return null

  return withoutFacebookSuffix
}

export async function readFacebookDisplayName(page: Page): Promise<string | null> {
  try {
    await page.goto('https://www.facebook.com/me', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    })
    await page.waitForTimeout(500)

    const url = page.url().toLowerCase()
    if (url.includes('/login/') || url.includes('/checkpoint/') || url.includes('/identity/')) return null

    const headings = [
      page.locator('[role="main"] h1').first(),
      page.locator('main h1').first(),
      page.locator('h1').first()
    ]
    for (const heading of headings) {
      if (!await heading.isVisible().catch(() => false)) continue
      const name = normalizeFacebookProfileName(await heading.innerText().catch(() => null))
      if (name) return name
    }

    const ogTitle = await page.locator('meta[property="og:title"]').first().getAttribute('content').catch(() => null)
    return normalizeFacebookProfileName(ogTitle)
  } catch {
    return null
  }
}
