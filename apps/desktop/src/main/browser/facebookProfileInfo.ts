import type { Page } from 'playwright-core'

export interface FacebookProfileHeaderCandidate {
  text: string | null
  fontSizePx: number
  top: number
  visible: boolean
  role: string | null
  tabIndex: number
}

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

export function pickFacebookProfileHeaderName(candidates: FacebookProfileHeaderCandidate[]): string | null {
  const ranked = candidates.flatMap((candidate) => {
    if (!candidate.visible) return []
    if (candidate.role !== 'button' || candidate.tabIndex !== 0) return []
    if (!Number.isFinite(candidate.fontSizePx) || candidate.fontSizePx < 24) return []
    if (!Number.isFinite(candidate.top) || candidate.top < 0) return []

    const name = normalizeFacebookProfileName(candidate.text)
    if (!name || name.length > 80 || name.includes('\n')) return []
    return [{ name, fontSizePx: candidate.fontSizePx, top: candidate.top }]
  })

  ranked.sort((left, right) => right.fontSizePx - left.fontSizePx || left.top - right.top)
  return ranked[0]?.name ?? null
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

    // Current Facebook profile headers can render the display name as a large
    // role=button node instead of an h1. Do not hard-code generated x* classes.
    const headerCandidates = await page.locator('[role="button"][tabindex="0"]').evaluateAll((elements) => {
      return elements.map((element) => {
        const htmlElement = element as HTMLElement
        const style = window.getComputedStyle(htmlElement)
        const rect = htmlElement.getBoundingClientRect()
        const opacity = Number.parseFloat(style.opacity || '1')
        return {
          text: htmlElement.innerText || htmlElement.textContent,
          fontSizePx: Number.parseFloat(style.fontSize || '0'),
          top: rect.top,
          visible: rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && opacity > 0,
          role: htmlElement.getAttribute('role'),
          tabIndex: htmlElement.tabIndex
        }
      })
    }).catch(() => [] as FacebookProfileHeaderCandidate[])
    const headerName = pickFacebookProfileHeaderName(headerCandidates)
    if (headerName) return headerName

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
