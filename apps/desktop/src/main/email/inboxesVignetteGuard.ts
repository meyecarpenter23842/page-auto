import type { Locator, Page } from 'playwright-core'
import { isInboxesProviderPageUrl } from './inboxesBackgroundPlaywrightDriver'

const GOOGLE_VIGNETTE_HASH = /(?:^|[#&])google_vignette(?:=|&|$)/i
const POPUP_SETTLE_MS = 120

export type InboxesVignetteDismissResult = 'none' | 'dismissed' | 'blocked'

type RuntimePageShape = {
  getByRole?: Page['getByRole']
  getByText?: Page['getByText']
  getByPlaceholder?: Page['getByPlaceholder']
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

/**
 * A hash is routing evidence, not proof that the ad still covers the provider.
 * Chrome/Inboxes can retain #google_vignette after F5 while the normal mailbox UI
 * is already usable. In that case the state machine must continue instead of
 * repeatedly declaring the provider blocked.
 */
export function shouldTreatInboxesVignetteAsBlocking(input: {
  url: string
  hasCloseControl: boolean
  hasBusinessUi: boolean
}): boolean {
  if (!isInboxesGoogleVignetteUrl(input.url)) return false
  if (input.hasCloseControl) return true
  return !input.hasBusinessUi
}

export function hasInboxesProviderEscaped(page: Pick<Page, 'isClosed' | 'url'>): boolean {
  if (page.isClosed()) return false
  const url = page.url()
  return url !== 'about:blank' && !isInboxesProviderPageUrl(url)
}

async function visible(locator: Locator): Promise<boolean> {
  return (await locator.count()) > 0 && await locator.first().isVisible().catch(() => false)
}

function hasVignetteUiCapabilities(page: Page): boolean {
  const candidate = runtimePageShape(page)
  return typeof candidate.getByRole === 'function'
    && typeof candidate.getByText === 'function'
    && typeof candidate.getByPlaceholder === 'function'
    && typeof candidate.locator === 'function'
    && typeof candidate.waitForTimeout === 'function'
}

async function hasInboxesBusinessUi(page: Page): Promise<boolean> {
  const username = page.getByPlaceholder(/enter username/i)
  const domain = page.getByRole('combobox')
  const addSubmit = page.getByRole('button', { name: /^add inbox$/i })
  if (await visible(username) && await visible(domain) && await visible(addSubmit)) return true

  const addEntry = page.getByRole('button', { name: /add inbox|get my first inbox/i }).first()
  if (await visible(addEntry)) return true

  const body = await page.locator('body').innerText({ timeout: 800 }).catch(() => '')
  return /waiting for incoming messages for/i.test(body)
    || /\bfrom\b/i.test(body) && /subject\s*-?\s*preview/i.test(body) && /\breceived\b/i.test(body)
}

/**
 * Dismiss only the operator-observed Inboxes Google vignette. A retained hash
 * with proven provider UI is treated as stale route state, not as an active ad.
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

  let hasCloseControl = false
  for (const control of controls) {
    if (!await visible(control)) continue
    hasCloseControl = true
    try {
      await control.click({ timeout: 1_200 })
      await page.waitForTimeout(80)
      const closeStillVisible = await visible(page.getByText(/^close$/i).last())
      return closeStillVisible ? 'blocked' : 'dismissed'
    } catch {
      // Try the next explicit Close control. Never click the vignette body.
    }
  }

  const hasBusinessUi = await hasInboxesBusinessUi(page)
  return shouldTreatInboxesVignetteAsBlocking({
    url: page.url(),
    hasCloseControl,
    hasBusinessUi
  }) ? 'blocked' : 'none'
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

    await popup.waitForLoadState('domcontentloaded', { timeout: 600 }).catch(() => undefined)
    if (isInboxesProviderPageUrl(popup.url())) continue

    await popup.close({ runBeforeUnload: false }).catch(() => undefined)
    closed += 1
  }

  return closed
}
