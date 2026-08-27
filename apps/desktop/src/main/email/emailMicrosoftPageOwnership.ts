import type { Page } from 'playwright-core'

export function isMicrosoftOwnedNavigationUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'outlook.live.com'
      || hostname === 'login.live.com'
      || hostname === 'account.live.com'
      || hostname === 'login.microsoftonline.com'
      || hostname === 'microsoft.com'
      || hostname.endsWith('.microsoft.com')
  } catch {
    return false
  }
}

export function isMicrosoftAuthNavigationUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'login.live.com' || hostname === 'login.microsoftonline.com'
  } catch {
    return false
  }
}

export function microsoftRouteLogLabel(value: string): string {
  try {
    const url = new URL(value)
    return `${url.hostname.toLowerCase()}${url.pathname}`
  } catch {
    return 'unknown'
  }
}

export async function waitForMicrosoftOwnedPage(page: Page, timeoutMs = 8_000): Promise<boolean> {
  if (page.isClosed()) return false
  if (isMicrosoftOwnedNavigationUrl(page.url())) return true

  const deadline = Date.now() + timeoutMs
  while (!page.isClosed() && Date.now() < deadline) {
    const remaining = Math.max(100, deadline - Date.now())
    const slice = Math.min(1_000, remaining)
    await Promise.race([
      page.waitForURL((url) => isMicrosoftOwnedNavigationUrl(url.toString()), { timeout: slice }).catch(() => undefined),
      page.waitForTimeout(Math.min(250, slice)).catch(() => undefined)
    ])
    if (!page.isClosed() && isMicrosoftOwnedNavigationUrl(page.url())) return true
  }

  return !page.isClosed() && isMicrosoftOwnedNavigationUrl(page.url())
}

/**
 * Microsoft can open a second auth page after account-picker / username / password actions,
 * not only from the Outlook landing CTA. Track pages that did not exist when this login loop
 * started and adopt the newest Microsoft-owned page. Existing operator tabs are ignored.
 */
export async function adoptNewestMicrosoftFlowPage(
  activePage: Page,
  pagesAtFlowStart: ReadonlySet<Page>,
  settleTimeoutMs = 1_500
): Promise<Page> {
  const pages = activePage.context().pages()
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const candidate = pages[index]
    if (!candidate) continue
    if (candidate === activePage || candidate.isClosed() || pagesAtFlowStart.has(candidate)) continue

    const candidateUrl = candidate.url()
    const canStillBecomeMicrosoft = candidateUrl === 'about:blank' || candidateUrl.startsWith('chrome-error://')
    if (!isMicrosoftOwnedNavigationUrl(candidateUrl) && !canStillBecomeMicrosoft) continue

    if (!isMicrosoftOwnedNavigationUrl(candidateUrl)
      && !await waitForMicrosoftOwnedPage(candidate, settleTimeoutMs)) {
      continue
    }

    if (candidate.isClosed() || !isMicrosoftOwnedNavigationUrl(candidate.url())) continue
    await candidate.bringToFront().catch(() => undefined)
    await closeDuplicateMicrosoftAuthPages(candidate)
    return candidate
  }

  return activePage
}

/**
 * Microsoft can leave a second login tab without a reliable opener relationship.
 * In the dedicated Email profile, close only duplicate Microsoft auth-host tabs while
 * preserving the active page, Outlook/mail pages and unrelated operator tabs.
 */
export async function closeDuplicateMicrosoftAuthPages(activePage: Page): Promise<void> {
  const context = activePage.context()
  for (const candidate of context.pages()) {
    if (candidate === activePage || candidate.isClosed()) continue
    if (!isMicrosoftAuthNavigationUrl(candidate.url())) continue
    await candidate.close({ runBeforeUnload: false }).catch(() => undefined)
  }
}

/**
 * Close the Microsoft-owned opener lineage of an adopted page, then clean up auth-host
 * siblings that Microsoft may have detached from opener(). This still leaves Outlook/mail,
 * account.live.com and unrelated operator tabs untouched.
 */
export async function closeMicrosoftOwnedOpenerChain(activePage: Page, maxDepth = 4): Promise<void> {
  let opener = await activePage.opener().catch(() => null)
  for (let depth = 0; opener && depth < maxDepth; depth += 1) {
    if (opener.isClosed() || !isMicrosoftOwnedNavigationUrl(opener.url())) break
    const nextOpener = await opener.opener().catch(() => null)
    await opener.close({ runBeforeUnload: false }).catch(() => undefined)
    opener = nextOpener
  }
  await closeDuplicateMicrosoftAuthPages(activePage)
}
