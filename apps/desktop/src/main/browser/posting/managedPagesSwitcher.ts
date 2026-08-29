import type { BrowserContext, Locator, Page } from 'playwright-core'
import type { BrowserSettings } from '../../../shared/appSettings'
import type { PostingJobResult } from '../../../shared/posting'
import { activeFacebookProfileId, detectFacebookAccessBlock } from './pageState'

export type ManagedPageTargetPresence = 'present' | 'not_listed' | 'unknown'

export interface ManagedPagesSwitchAttempt {
  result: PostingJobResult | null
  diagnostic: string
  targetPresence: ManagedPageTargetPresence
}

export interface ManagedPagesAbsenceEvidence {
  surfaceRecognized: boolean
  explicitEmptyState: boolean
  atBottom: boolean
  loading: boolean
  stableBottomPasses: number
  observedPageUidCount: number
}

const MANAGED_PAGES_URL = 'https://www.facebook.com/pages/?category=your_pages&ref=bookmarks'
const MANAGED_PAGES_SURFACE_PATTERN = /pages you manage|your pages|trang bạn quản lý|các trang bạn quản lý|trang của bạn|halaman yang anda kelola|halaman anda/i
const MANAGED_PAGES_EMPTY_PATTERN = /you don't have any pages|you have no pages|no pages to show|bạn chưa có trang|không có trang nào|anda tidak memiliki halaman|tidak ada halaman/i
const SWITCH_ACTION_PATTERN = /switch now|switch into(?: this page)?|switch to(?: this page)?|chuyển ngay|chuyển sang(?: trang này)?|beralih sekarang|beralih ke(?: halaman ini)?|ganti sekarang|ganti ke(?: halaman ini)?/i
const MORE_ACTIONS_PATTERN = /more|options|actions|menu|lainnya|opsi|selengkapnya|khác|thêm/i
const POLL_MS = 200
const ENUMERATION_SETTLE_MS = 300
const REQUIRED_STABLE_BOTTOM_PASSES = 2

type PostingCode = NonNullable<PostingJobResult['code']>

interface ManagedPagesEnumerationProbe {
  surfaceRecognized: boolean
  explicitEmptyState: boolean
  atBottom: boolean
  loading: boolean
  scrollHeight: number
  observedPageUids: string[]
}

interface ManagedPagesTargetScan {
  targetLink: Locator | null
  targetPresence: ManagedPageTargetPresence
  diagnostic: string
}

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
  pageUid: string,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + Math.max(500, timeoutMs)
  while (Date.now() < deadline) {
    if ((await activeFacebookProfileId(context).catch(() => null))?.trim() === pageUid.trim()) return true
    if (await detectFacebookAccessBlock(page)) return false
    await page.waitForTimeout(POLL_MS).catch(() => undefined)
  }
  return false
}

export function managedPageUidFromHref(rawHref: string): string | null {
  try {
    const parsed = new URL(rawHref, 'https://www.facebook.com/')
    const host = parsed.hostname.toLowerCase()
    if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) return null

    if (parsed.pathname.toLowerCase() === '/profile.php') {
      const id = parsed.searchParams.get('id')?.trim() ?? ''
      return /^\d+$/.test(id) ? id : null
    }

    const firstSegment = parsed.pathname.split('/').filter(Boolean)[0]?.trim() ?? ''
    return /^\d+$/.test(firstSegment) ? firstSegment : null
  } catch {
    return null
  }
}

export function managedPageHrefMatchesUid(pageUid: string, rawHref: string): boolean {
  const uid = pageUid.trim()
  return Boolean(uid && /^\d+$/.test(uid) && managedPageUidFromHref(rawHref) === uid)
}

export function managedPagesAbsenceConfirmed(evidence: ManagedPagesAbsenceEvidence): boolean {
  if (!evidence.surfaceRecognized || evidence.loading) return false
  if (evidence.explicitEmptyState) return true
  return evidence.atBottom
    && evidence.stableBottomPasses >= REQUIRED_STABLE_BOTTOM_PASSES
    && evidence.observedPageUidCount > 0
}

export function isManagedPagesSwitchLabel(value: string): boolean {
  return SWITCH_ACTION_PATTERN.test(value.replace(/\s+/g, ' ').trim())
}

async function findManagedPageLinkOnce(page: Page, pageUid: string): Promise<Locator | null> {
  const uid = escapeCss(pageUid.trim())
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

  return fallback
}

async function probeManagedPagesEnumeration(page: Page): Promise<ManagedPagesEnumerationProbe> {
  const main = page.locator('[role="main"], main').first()
  const surfaceRecognized = await visibleCount(main.getByText(MANAGED_PAGES_SURFACE_PATTERN)) > 0
  const explicitEmptyState = await visibleCount(main.getByText(MANAGED_PAGES_EMPTY_PATTERN)) > 0
  const loading = await visibleCount(main.locator('[role="progressbar"], [aria-busy="true"]')) > 0
  const hrefs = await main.locator('a[href]').evaluateAll((elements) => (
    elements.map((element) => element.getAttribute('href')).filter((href): href is string => Boolean(href))
  )).catch(() => [] as string[])
  const observedPageUids = [...new Set(hrefs.map(managedPageUidFromHref).filter((uid): uid is string => Boolean(uid)))]
  const metrics = await page.evaluate(() => {
    const scrolling = document.scrollingElement ?? document.documentElement
    const scrollHeight = Math.max(scrolling.scrollHeight, document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)
    const viewportBottom = scrolling.scrollTop + window.innerHeight
    return {
      scrollHeight,
      atBottom: viewportBottom >= scrollHeight - 8
    }
  }).catch(() => ({ scrollHeight: -1, atBottom: false }))

  return {
    surfaceRecognized,
    explicitEmptyState,
    loading,
    scrollHeight: metrics.scrollHeight,
    atBottom: metrics.atBottom,
    observedPageUids
  }
}

async function scanManagedPagesTarget(page: Page, pageUid: string, timeoutMs: number): Promise<ManagedPagesTargetScan> {
  const deadline = Date.now() + Math.max(1_000, timeoutMs)
  const observedPageUids = new Set<string>()
  let surfaceRecognized = false
  let explicitEmptyState = false
  let stableBottomPasses = 0
  let lastScrollHeight = -1

  while (Date.now() <= deadline) {
    const targetLink = await findManagedPageLinkOnce(page, pageUid)
    if (targetLink) return { targetLink, targetPresence: 'present', diagnostic: 'uid-link-found' }

    const probe = await probeManagedPagesEnumeration(page)
    surfaceRecognized ||= probe.surfaceRecognized
    explicitEmptyState ||= probe.explicitEmptyState
    for (const uid of probe.observedPageUids) observedPageUids.add(uid)

    const stableBottom = probe.atBottom
      && !probe.loading
      && probe.scrollHeight >= 0
      && probe.scrollHeight === lastScrollHeight
    stableBottomPasses = stableBottom ? stableBottomPasses + 1 : 0

    if (managedPagesAbsenceConfirmed({
      surfaceRecognized,
      explicitEmptyState,
      atBottom: probe.atBottom,
      loading: probe.loading,
      stableBottomPasses,
      observedPageUidCount: observedPageUids.size
    })) {
      return { targetLink: null, targetPresence: 'not_listed', diagnostic: 'uid-not-listed-confirmed' }
    }

    lastScrollHeight = probe.scrollHeight
    await page.evaluate(() => {
      const scrolling = document.scrollingElement ?? document.documentElement
      window.scrollTo(0, scrolling.scrollHeight)
    }).catch(() => undefined)
    await page.waitForTimeout(ENUMERATION_SETTLE_MS).catch(() => undefined)
  }

  return { targetLink: null, targetPresence: 'unknown', diagnostic: 'uid-link-missing-unconfirmed' }
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

async function openManagedPageMenu(page: Page, card: Locator, networkTimeoutMs: number): Promise<Locator | null> {
  const rootsBefore = await actionOverlayRoots(page).count().catch(() => 0)
  const semanticItem = await firstVisible(card.getByRole('button', { name: MORE_ACTIONS_PATTERN }))
  const structuralItem = await firstVisible(card.getByRole('button').last())
  const candidates = [semanticItem, structuralItem].filter((item): item is Locator => item !== null)

  for (const candidate of candidates) {
    if (!await clickWithDomFallback(candidate, networkTimeoutMs)) continue

    const deadline = Date.now() + networkTimeoutMs
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
  pageUid: string,
  networkTimeoutMs = browser.navigationTimeoutMs
): Promise<ManagedPagesSwitchAttempt> {
  const uid = pageUid.trim()
  try {
    await page.goto(MANAGED_PAGES_URL, {
      waitUntil: 'domcontentloaded',
      timeout: browser.navigationTimeoutMs
    })
    if (browser.pageSettleDelayMs > 0) await page.waitForTimeout(browser.pageSettleDelayMs)
  } catch {
    return { result: null, diagnostic: 'navigation-failed', targetPresence: 'unknown' }
  }

  const accessBlock = await blocked(page)
  if (accessBlock) return { result: accessBlock, diagnostic: 'blocked', targetPresence: 'unknown' }

  if (await identityMatches(page, context, uid, 500)) {
    return {
      result: { status: 'success', message: 'Page identity đã active và khớp i_user trên Pages you manage.' },
      diagnostic: 'already-active',
      targetPresence: 'present'
    }
  }

  const targetScan = await scanManagedPagesTarget(page, uid, networkTimeoutMs)
  if (!targetScan.targetLink) {
    return {
      result: null,
      diagnostic: targetScan.diagnostic,
      targetPresence: targetScan.targetPresence
    }
  }
  const targetLink = targetScan.targetLink

  const card = await findManagedPageCard(targetLink)
  if (!card) return { result: null, diagnostic: 'uid-card-missing', targetPresence: 'present' }

  const actionRoot = await openManagedPageMenu(page, card, networkTimeoutMs)
  if (!actionRoot) return { result: null, diagnostic: 'uid-card-menu-not-opened', targetPresence: 'present' }

  const switchAction = await findSwitchAction(actionRoot)
  if (!switchAction) return { result: null, diagnostic: 'switch-action-missing', targetPresence: 'present' }

  if (!await clickWithDomFallback(switchAction, networkTimeoutMs)) {
    return { result: null, diagnostic: 'switch-action-click-failed', targetPresence: 'present' }
  }

  if (await identityMatches(page, context, uid, networkTimeoutMs)) {
    return {
      result: { status: 'success', message: 'Đã switch đúng Page từ Pages you manage và xác minh i_user đúng Page UID.' },
      diagnostic: 'success',
      targetPresence: 'present'
    }
  }

  const afterClickBlock = await blocked(page)
  if (afterClickBlock) return { result: afterClickBlock, diagnostic: 'blocked-after-switch', targetPresence: 'present' }
  return { result: null, diagnostic: 'switch-action-unconfirmed', targetPresence: 'present' }
}
