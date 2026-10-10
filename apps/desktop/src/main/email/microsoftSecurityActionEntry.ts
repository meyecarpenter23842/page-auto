import type { BrowserContext, Page } from 'playwright-core'

export const MICROSOFT_ACCOUNT_HOME_URL =
  'https://account.microsoft.com/?ref=MeControl&refd=account.microsoft.com'

export const MICROSOFT_SECURITY_URL = 'https://account.microsoft.com/security'

export function isMicrosoftAccountHubUrl(value: string): boolean {
  try {
    return new URL(value).hostname.toLowerCase() === 'account.microsoft.com'
  } catch {
    return false
  }
}

export interface MicrosoftAccountPageCandidate {
  url: string
  closed: boolean
}

export function selectMicrosoftAccountHomePageIndex(
  pages: readonly MicrosoftAccountPageCandidate[]
): number | null {
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const page = pages[index]
    if (page && !page.closed && isMicrosoftAccountHubUrl(page.url)) return index
  }

  const openPages = pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => !page.closed)

  if (openPages.length === 1 && openPages[0]?.page.url === 'about:blank') {
    return openPages[0].index
  }

  return null
}

export function isMicrosoftSecurityAuthResumeUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (host === 'outlook.live.com') return false
    if (host === 'account.microsoft.com') return false
    if (host === 'login.microsoft.com' && url.pathname.toLowerCase().includes('/consumers/fido/create')) return false
    return host === 'login.live.com'
      || host === 'login.microsoftonline.com'
      || host === 'login.microsoft.com'
      || host === 'account.live.com'
  } catch {
    return false
  }
}

export function findExistingMicrosoftSecurityAuthPage(context: BrowserContext): Page | null {
  const pages = [...context.pages()].reverse()
  return pages.find((page) => !page.isClosed() && isMicrosoftSecurityAuthResumeUrl(page.url())) ?? null
}

export async function openMicrosoftAccountHome(context: BrowserContext): Promise<Page> {
  const pages = context.pages()
  const selectedIndex = selectMicrosoftAccountHomePageIndex(
    pages.map((page) => ({ url: page.url(), closed: page.isClosed() }))
  )
  const page = selectedIndex === null
    ? await context.newPage()
    : pages[selectedIndex]!

  await page.goto(MICROSOFT_ACCOUNT_HOME_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000
  })
  await page.bringToFront().catch(() => undefined)
  return page
}
