import type { Page } from 'playwright-core'

function normalizeProfileName(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!normalized) return null
  const generic = /^(facebook|log in|login|đăng nhập|home|trang chủ)$/i
  return generic.test(normalized) ? null : normalized
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
      page.locator('h1').first()
    ]
    for (const heading of headings) {
      if (!await heading.isVisible().catch(() => false)) continue
      const name = normalizeProfileName(await heading.innerText().catch(() => null))
      if (name) return name
    }

    const title = normalizeProfileName((await page.title().catch(() => '')).replace(/\s*[|\-]\s*Facebook\s*$/i, ''))
    return title
  } catch {
    return null
  }
}
