import type { Page } from 'playwright-core'
import { isInboxesProviderPageUrl } from './inboxesBackgroundPlaywrightDriver'

const GOOGLE_VIGNETTE_HASH = /(?:^|[#&])google_vignette(?:=|&|$)/i
const POPUP_SETTLE_MS = 200

export type InboxesVignetteDismissResult = 'none' | 'dismissed' | 'blocked'

type RuntimePageShape = {
  getByRole?: Page['getByRole']
  getByText?: Page['getByText']
  locator?: Page['locator']
  waitForTimeout?: Page['waitForTimeout']
  context?: Page['context']
}

function runtimePageShape(page: Page): RuntimePageShape {
  return page as unknown as RuntimePageShape
}

export function isInboxesGoogleVignetteUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return isInboxesProviderPageUrl(value) && GOOGLE_VIGNETTE_HASH.test(url.hash.replace(/^#/, ''))
  } catch {
    return false
  }
}

export function hasInboxesProviderEscaped(page: Pick<Page, 'isClosed' | 'url'>): boolean {
  if (page.isClosed()) return false
  const url = page.url()
  return url !== 'about:blank' && !isInboxesProviderPageUrl(url)
}

async function visible(locator: ReturnType<Page['getByText']>): Promise<boolean> {
  return (await locator.count()) > 0 && await locator.first().isVisible().catch(() => false)
}

function hasVignetteUiCapabilities(page: Page): boolean {
  const candidate = runtimePageShape(page)
  return typeof candidate.getByRole === 'function'
    && typeof candidate.getByText === 'function'
    && typeof candidate.locator === 'function'
    && typeof candidate.waitForTimeout === 'function'
}

/**
 * Dismiss only the operator-observed Inboxes Google vignette. We intentionally
 * do not click a generic page-level Close unless the provider URL proves that
 * the Google vignette surface is active.
 *
 * The capability guard keeps MailboxCodeService's pure unit-test Page doubles
 * isolated from browser-DOM concerns. A real Playwright Page always provides
 * these APIs; a partial test double simply leaves vignette handling to the
 * provider result path being exercised by that test.
 */
export async function dismissInboxesGoogleVignette(page: Page): Promise<InboxesVignetteDismissResult> {
  if (page.isClosed() || !isInboxesGoogleVignetteUrl(page.url())) return 'none'
  if (!hasVignetteUiCapabilities(page)) return 'none'

  const controls = [
    page.getByRole('button', { name: /^close$/i }).last(),
    page.getByRole('link', { name: /^close$/i }).last(),
    page.locator('button[aria-label*="close" i]:visible, [role="button"][aria-label*="close" i]:visible').last(),
    page.getByText(/^close$/i).last()
  ]

  for (const control of controls) {
    if (!await visible(control)) continue
    try {
      await control.click({ timeout: 1_500 })
      await page.waitForTimeout(120)
      const closeStillVisible = await visible(page.getByText(/^close$/i).last())
      return closeStillVisible ? 'blocked' : 'dismissed'
    } catch {
      // Try the next explicit Close control. Never click the vignette body.
    }
  }

  return 'blocked'
}

/** Return a real immutable snapshot only when this is a full Playwright Page. */
export function snapshotInboxesContextPages(providerPage: Page): readonly Page[] {
  const candidate = runtimePageShape(providerPage)
  if (typeof candidate.context !== 'function') return []
  try {
    return [...providerPage.context().pages()]
  } catch {
    return []
  }
}

/**
 * Close only newly-created pages whose opener is the Inboxes provider page and
 * whose destination is not Inboxes. This catches ad clicks such as a Lenovo
 * landing tab without touching Microsoft or unrelated tabs that already existed.
 */
export async function closeUnexpectedInboxesPopupPages(
  providerPage: Page,
  pagesBefore: readonly Page[]
): Promise<number> {
  if (providerPage.isClosed()) return 0
  const candidate = runtimePageShape(providerPage)
  if (typeof candidate.context !== 'function') return 0

  if (typeof candidate.waitForTimeout === 'function') {
    await providerPage.waitForTimeout(POPUP_SETTLE_MS).catch(() => undefined)
  }

  const before = new Set(pagesBefore)
  let pages: readonly Page[]
  try {
    pages = providerPage.context().pages()
  } catch {
    return 0
  }

  let closed = 0
  for (const popup of pages) {
    if (popup === providerPage || before.has(popup) || popup.isClosed()) continue

    const opener = await popup.opener().catch(() => null)
    if (opener !== providerPage) continue

    await popup.waitForLoadState('domcontentloaded', { timeout: 750 }).catch(() => undefined)
    if (isInboxesProviderPageUrl(popup.url())) continue

    await popup.close({ runBeforeUnload: false }).catch(() => undefined)
    closed += 1
  }

  return closed
}
