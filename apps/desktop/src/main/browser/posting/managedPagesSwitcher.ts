import type { BrowserContext, Locator, Page } from 'playwright-core'
import type { BrowserSettings } from '../../../shared/appSettings'
import type { PostingJobResult } from '../../../shared/posting'
import { activeFacebookProfileId, detectFacebookAccessBlock } from './pageState'

export interface ManagedPagesSwitchAttempt {
  result: PostingJobResult | null
  diagnostic: string
}

const MANAGED_PAGES_URL = 'https://www.facebook.com/pages/?category=your_pages&ref=bookmarks'
const SWITCH_ACTION_PATTERN = /switch now|switch into(?: this page)?|switch to(?: this page)?|chuyển ngay|chuyển sang(?: trang này)?|beralih sekarang|beralih ke(?: halaman ini)?|ganti sekarang|ganti ke(?: halaman ini)?/i
const MORE_ACTIONS_PATTERN = /more|options|actions|menu|lainnya|opsi|selengkapnya|khác|thêm/i
const POLL_MS = 200
const FIND_UID_TIMEOUT_MS = 6_000
const MENU_TIMEOUT_MS = 4_000
const IDENTITY_TIMEOUT_MS = 12_000

type PostingCode = NonNullable<PostingJobResult['code']>

function failure(code: PostingCode, message: string): PostingJobResult {
  return {
    status: code === 'needs_login' || code === 'verification_required' ? 'needs_login' : 'failed',
    code,
    message
  }
}

function escapeCss(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function visibleCount(locator: Locator): Promise<number> {
  const count = await locator.count().catch(() => 0)
  let visible = 0
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) visible += 1
  }
  return visible
}

async function firstVisible(locator: Locator): Promise<Locator | null> {
  const count = await locator.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index)
    if (await item.isVisible().catch(() => false)) return item
  }
  return null
}

async function clickWithDomFallback(locator: Locator, timeoutMs: number): Promise<boolean> {
  if (!await locator.isVisible().catch(() => false)) return false
  if (!await locator.isEnabled().catch(() => true)) return false

  const clicked = await locator.click({ timeout: timeoutMs }).then(() => true).catch(() => false)
  if (clicked) return true

  return locator.evaluate((element) => {
    if (element instanceof HTMLElement) {
      element.click()
      return true
    }
    return element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
  }).then(() => true).catch(() => false)
}

async function blocked(page: Page): Promise<PostingJobResult | null> {
  const state = await detectFacebookAccessBlock(page)
  if (state === 'login_required') return failure('needs_login', 'Facebook yêu cầu đăng nhập lại trong lúc chuyển Page.')
  if (state === 'verification_required') return failure('verification_required', 'Facebook yêu cầu checkpoint/xác minh thủ công trong lúc chuyển Page.')
  return null
}

async function identityMatches(
  page: Page,
  context: BrowserContext,
  browser: BrowserSettings,
  pageUid: string,
  timeoutMs = IDENTITY_TIMEOUT_MS
): Promise<boolean> {
  const deadline = Date.now() + Math.max(500, Math.min(timeoutMs, browser.navigationTimeoutMs))
  while (Date.now() < deadline) {
    if ((await activeFacebookProfileId(context).catch(() => null))?.trim() === pageUid.trim()) return true
    if (await detectFacebookAccessBlock(page)) return false
    await page.waitForTimeout(POLL_MS).catch(() => undefined)
  }
  return false
}

export function managedPageHrefMatchesUid(pageUid: string, rawHref: string): boolean {
  const uid = pageUid.trim()
  if (!uid || !/^\d+$/.test(uid)) return false

  try {
    const parsed = new URL(rawHref, 'https://www.facebook.com/')
    const host = parsed.hostname.toLowerCase()
    if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) return false

    if (parsed.pathname.toLowerCase() === '/profile.php') {
      return parsed.searchParams.get('id') === uid
    }

    const segments = parsed.pathname.split('/').filter(Boolean)
    return segments[0] === uid
  } catch {
    return false
  }
}

export function isManagedPagesSwitchLabel(value: string): boolean {
  return SWITCH_ACTION_PATTERN.test(value.replace(/\s+/g, ' ').trim())
}

async function findManagedPageLink(page: Page, pageUid: string, timeoutMs: number): Promise<Locator | null> {
  const uid = escapeCss(pageUid.trim())
  const deadline = Date.now() + Math.max(1_000, timeoutMs)

  while (Date.now() < deadline) {
    const links = page.locator(`a[href*="${uid}"]`)
    const count = await links.count().catch(() => 0)
    let fallback: Locator | null = null

    for (let index = 0; index < count; index += 1) {
      const link = links.nth(index)
      if (!await link.isVisible().catch(() => false)) continue
      const href = await link.getAttribute('href').catch(() => null)
      if (!href || !managedPageHrefMatchesUid(pageUid, href)) continue

      const text = (await link.innerText().catch(() => '')).trim()
      if (text) return link
      fallback ??= link
    }

    if (fallback) return fallback
    await page.waitForTimeout(POLL_MS).catch(() => undefined)
  }

  return null
}

async function findManagedPageCard(targetLink: Locator): Promise<Locator | null> {
  const candidates = [
    targetLink.locator('xpath=ancestor::div[.//*[@role="button"]][1]'),
    targetLink.locator('xpath=ancestor::div[.//button][1]')
  ]

  for (const candidate of candidates) {
    if (!await candidate.isVisible().catch(() => false)) continue
    const controls = candidate.locator('[role="button"], button')
    if (await visibleCount(controls) > 0) return candidate
  }
  return null
}

function actionOverlayRoots(page: Page): Locator {
  return page.locator('[role="menu"]:visible, [role="dialog"]:visible, [aria-modal="true"]:visible')
}

async function openManagedPageMenu(page: Page, card: Locator, browser: BrowserSettings): Promise<Locator | null> {
  const rootsBefore = await actionOverlayRoots(page).count().catch(() => 0)
  const timeout = Math.min(browser.navigationTimeoutMs, 5_000)
  const semanticItem = await firstVisible(card.getByRole('button', { name: MORE_ACTIONS_PATTERN }))
  const structuralItem = await firstVisible(card.getByRole('button').last())
  const candidates = [semanticItem, structuralItem].filter((item): item is Locator => item !== null)

  for (const candidate of candidates) {
    if (!await clickWithDomFallback(candidate, timeout)) continue

    const deadline = Date.now() + MENU_TIMEOUT_MS
    while (Date.now() < deadline) {
      const roots = actionOverlayRoots(page)
      const count = await roots.count().catch(() => 0)
      if (count > rootsBefore) return roots.last()
      await page.waitForTimeout(POLL_MS).catch(() => undefined)
    }
    await page.keyboard.press('Escape').catch(() => undefined)
  }

  return null
}

async function findSwitchAction(root: Locator): Promise<Locator | null> {
  const scoped = [
    root.getByRole('menuitem', { name: SWITCH_ACTION_PATTERN }),
    root.getByRole('button', { name: SWITCH_ACTION_PATTERN }),
    root.getByRole('link', { name: SWITCH_ACTION_PATTERN }),
    root.getByText(SWITCH_ACTION_PATTERN)
  ]
  for (const candidate of scoped) {
    const item = await firstVisible(candidate)
    if (item) return item
  }

  // Structural fallback stays inside the overlay opened from the exact UID card.
  // On the observed Facebook surface Switch Now is the first menu item.
  const menuItems = root.getByRole('menuitem')
  if (await visibleCount(menuItems) >= 2) return firstVisible(menuItems.first())
  return null
}

export async function tryManagedPagesSwitch(
  page: Page,
  context: BrowserContext,
  browser: BrowserSettings,
  pageUid: string
): Promise<ManagedPagesSwitchAttempt> {
  const uid = pageUid.trim()
  try {
    await page.goto(MANAGED_PAGES_URL, {
      waitUntil: 'domcontentloaded',
      timeout: browser.navigationTimeoutMs
    })
    if (browser.pageSettleDelayMs > 0) await page.waitForTimeout(browser.pageSettleDelayMs)
  } catch {
    return { result: null, diagnostic: 'navigation-failed' }
  }

  const accessBlock = await blocked(page)
  if (accessBlock) return { result: accessBlock, diagnostic: 'blocked' }

  if (await identityMatches(page, context, browser, uid, 500)) {
    return {
      result: { status: 'success', message: 'Page identity đã active và khớp i_user trên Pages you manage.' },
      diagnostic: 'already-active'
    }
  }

  const targetLink = await findManagedPageLink(page, uid, Math.min(FIND_UID_TIMEOUT_MS, browser.navigationTimeoutMs))
  if (!targetLink) return { result: null, diagnostic: 'uid-link-missing' }

  const card = await findManagedPageCard(targetLink)
  if (!card) return { result: null, diagnostic: 'uid-card-missing' }

  const actionRoot = await openManagedPageMenu(page, card, browser)
  if (!actionRoot) return { result: null, diagnostic: 'uid-card-menu-not-opened' }

  const switchAction = await findSwitchAction(actionRoot)
  if (!switchAction) return { result: null, diagnostic: 'switch-action-missing' }

  if (!await clickWithDomFallback(switchAction, Math.min(browser.navigationTimeoutMs, 5_000))) {
    return { result: null, diagnostic: 'switch-action-click-failed' }
  }

  if (await identityMatches(page, context, browser, uid)) {
    return {
      result: { status: 'success', message: 'Đã switch đúng Page từ Pages you manage và xác minh i_user đúng Page UID.' },
      diagnostic: 'success'
    }
  }

  const afterClickBlock = await blocked(page)
  if (afterClickBlock) return { result: afterClickBlock, diagnostic: 'blocked-after-switch' }
  return { result: null, diagnostic: 'switch-action-unconfirmed' }
}
