import type { Page } from 'playwright-core'

export function normalizeFacebookProfileName(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!normalized) return null

  const withoutNotificationCounter = normalized.replace(/^\(\d+\+?\)\s*/, '').trim()
  if (!withoutNotificationCounter) return null

  const withoutFacebookSuffix = withoutNotificationCounter.replace(/\s*[|\-–—]\s*Facebook\s*$/i, '').trim()
  if (!withoutFacebookSuffix) return null

  const generic = /^(facebook|log in|login|đăng nhập|home|trang chủ)$/i
  if (generic.test(withoutFacebookSuffix)) return null

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
    const metadataName = normalizeFacebookProfileName(ogTitle)
    if (metadataName) return metadataName

    // Modern Facebook profiles do not consistently expose h1/og:title. The tab title
    // is a useful final fallback after stripping notification counters such as "(20+)".
    return normalizeFacebookProfileName(await page.title().catch(() => ''))
  } catch {
    return null
  }
}
