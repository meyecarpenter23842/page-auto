import type { BrowserContext, Locator, Page } from 'playwright-core'
import type { BrowserSettings } from '../../../shared/appSettings'
import type { PostingJobResult } from '../../../shared/posting'
import {
  tryManagedPagesSwitch,
  type ManagedPageTargetPresence
} from './managedPagesSwitcher'
import { activeFacebookProfileId, detectFacebookAccessBlock } from './pageState'

export type PageIdentityUidState = 'match' | 'missing' | 'other'
export type PageIdentityStage = 'page_surface' | 'account_menu' | 'all_profiles'
export type PageIdentityAction =
  | 'success'
  | 'click_direct_switch'
  | 'open_account_menu'
  | 'click_see_all_profiles'
  | 'select_target_uid'
  | 'select_target_name'
  | 'fail'

export interface PageIdentityEvidence {
  stage: PageIdentityStage
  uidState: PageIdentityUidState
  directSwitchCount: number
  accountMenuCount: number
  seeAllProfilesCount: number
  targetUidCount: number
  targetNameCount: number
  directAttempted: boolean
}

export interface PageIdentityDiagnostics extends PageIdentityEvidence {
  homeFallbackAttempted: boolean
  targetNameAvailable: boolean
  candidateAttempts: string[]
  url: string
}

export interface PageIdentitySurfaceSnapshot {
  url: string
  chooserRootCount: number
  dialogCount: number
  chooserMarkerCount: number
  targetUidCount: number
  targetNameCount: number
  seeAllProfilesCount: number
}

type PostingCode = NonNullable<PostingJobResult['code']>
type VerifyClick = () => Promise<boolean>

interface NamedLocator {
  strategy: string
  locator: Locator
}

const DIRECT_SWITCH_PATTERN = /switch now|switch into(?: this page)?|switch to(?: this page)?|chuyển ngay|chuyển sang(?: trang này)?/i
const SEE_ALL_PROFILES_PATTERN = /see all profiles|xem tất cả trang cá nhân|xem tất cả hồ sơ|xem tất cả trang/i
const ACCOUNT_MENU_PATTERN = /^(?:your profile(?:\b.*)?|profile picture(?:\b.*)?|account controls(?:\b.*)?|account menu(?:\b.*)?|account|tài khoản|menu tài khoản|ảnh đại diện(?:\b.*)?|trang cá nhân(?:\b.*)?)$/i
const CHOOSER_MARKER_PATTERN = /see all profiles|switch profile|select profile|your profiles|profiles and pages|xem tất cả trang cá nhân|xem tất cả hồ sơ|chuyển trang cá nhân|chọn trang cá nhân|trang và trang cá nhân/i
const PROFILE_KIND_PATTERN = /^(?:page|profile|trang|trang cá nhân)(?:\b.*)?$/i
const POLL_MS = 200
const MAX_ACTION_CANDIDATES = 24
const MAX_DIAGNOSTIC_ATTEMPTS = 28

function failure(code: PostingCode, message: string): PostingJobResult {
  return {
    status: code === 'needs_login' || code === 'verification_required' ? 'needs_login' : 'failed',
    code,
    message
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function escapeCss(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function classifyPageIdentityUid(
  expectedPageUid: string,
  activeProfileId: string | null | undefined
): PageIdentityUidState {
  const expected = expectedPageUid.trim()
  const active = activeProfileId?.trim() || null
  if (!active) return 'missing'
  return active === expected ? 'match' : 'other'
}

export function shouldEndPageIdentityForUnavailableAccess(
  targetPresence: ManagedPageTargetPresence,
  firstPassExhausted: boolean
): boolean {
  return firstPassExhausted && targetPresence === 'not_listed'
}

export function isAccountMenuAccessibleName(value: string): boolean {
  return ACCOUNT_MENU_PATTERN.test(normalizeText(value))
}

export function isDirectSwitchAccessibleName(value: string): boolean {
  return DIRECT_SWITCH_PATTERN.test(normalizeText(value))
}

export function isTargetProfileAccessibleName(targetName: string, value: string): boolean {
  const target = normalizeText(targetName)
  const candidate = normalizeText(value)
  if (!target || !candidate) return false
  if (candidate.localeCompare(target, undefined, { sensitivity: 'accent' }) === 0) return true

  const suffix = candidate.match(
    new RegExp(`^${escapeRegex(target)}\\s*(?:[·•|—–,:-]\\s*)?(.+)$`, 'i')
  )?.[1]?.trim()
  return Boolean(suffix && PROFILE_KIND_PATTERN.test(suffix))
}

export function targetIdentityScope(
  stage: PageIdentityStage
): 'none' | 'overlay-only' | 'verified-all-profiles-surface' {
  if (stage === 'account_menu') return 'overlay-only'
  if (stage === 'all_profiles') return 'verified-all-profiles-surface'
  return 'none'
}

export function resolvePageIdentityAction(evidence: PageIdentityEvidence): PageIdentityAction {
  if (evidence.uidState === 'match') return 'success'
  if (evidence.stage === 'page_surface') {
    if (!evidence.directAttempted && evidence.directSwitchCount > 0) return 'click_direct_switch'
    if (evidence.seeAllProfilesCount > 0) return 'click_see_all_profiles'
    if (evidence.accountMenuCount > 0) return 'open_account_menu'
    return 'fail'
  }
  if (evidence.stage === 'account_menu') {
    if (evidence.targetUidCount > 0) return 'select_target_uid'
    if (evidence.targetNameCount > 0) return 'select_target_name'
    if (evidence.seeAllProfilesCount > 0) return 'click_see_all_profiles'
    return 'fail'
  }
  if (evidence.targetUidCount > 0) return 'select_target_uid'
  if (evidence.targetNameCount > 0) return 'select_target_name'
  return 'fail'
}

export function shouldRetryPageIdentityFromHome(
  evidence: PageIdentityEvidence,
  homeFallbackAttempted: boolean
): boolean {
  return !homeFallbackAttempted
    && (evidence.stage === 'page_surface' || evidence.stage === 'account_menu')
    && evidence.uidState !== 'match'
    && resolvePageIdentityAction(evidence) === 'fail'
}

export function shouldRetryPageIdentityAfterControlFailure(
  action: PageIdentityAction,
  stage: PageIdentityStage,
  homeFallbackAttempted: boolean
): boolean {
  return !homeFallbackAttempted && stage === 'page_surface' && action === 'open_account_menu'
}

export function pageIdentityActionRequiresSurfaceVerification(action: PageIdentityAction): boolean {
  return action === 'open_account_menu' || action === 'click_see_all_profiles'
}

export function pageIdentitySurfaceAdvanced(
  before: PageIdentitySurfaceSnapshot,
  after: PageIdentitySurfaceSnapshot
): boolean {
  if (after.targetUidCount > before.targetUidCount || after.targetNameCount > before.targetNameCount) return true

  const seeAllConsumed = before.seeAllProfilesCount > after.seeAllProfilesCount
    && (after.targetUidCount > 0 || after.targetNameCount > 0)
  if (seeAllConsumed) return true

  const rootExpanded = after.chooserRootCount > before.chooserRootCount || after.dialogCount > before.dialogCount
  if (rootExpanded && (after.chooserMarkerCount > 0 || after.targetUidCount > 0 || after.targetNameCount > 0)) return true

  const urlChanged = safePageIdentityUrl(after.url) !== safePageIdentityUrl(before.url)
  return urlChanged && (after.chooserMarkerCount > 0 || after.targetUidCount > 0 || after.targetNameCount > 0)
}

export function safePageIdentityUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'unknown'
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().slice(0, 384)
  } catch {
    return 'unknown'
  }
}

export function formatPageIdentityDiagnostics(input: PageIdentityDiagnostics): string {
  return [
    `stage=${input.stage}`,
    `i_user=${input.uidState}`,
    `controls{direct=${input.directSwitchCount},account=${input.accountMenuCount},seeAll=${input.seeAllProfilesCount},uid=${input.targetUidCount},name=${input.targetNameCount}}`,
    `directAttempted=${input.directAttempted ? 'yes' : 'no'}`,
    `homeFallback=${input.homeFallbackAttempted ? 'yes' : 'no'}`,
    `targetName=${input.targetNameAvailable ? 'available' : 'missing'}`,
    `attempts=${input.candidateAttempts.length ? input.candidateAttempts.join(',') : 'none'}`,
    `url=${safePageIdentityUrl(input.url)}`
  ].join(' ')
}

async function visibleCount(locator: Locator): Promise<number> {
  const count = await locator.count().catch(() => 0)
  let visible = 0
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) visible += 1
  }
  return visible
}

async function countAcross(candidates: NamedLocator[]): Promise<number> {
  let total = 0
  for (const candidate of candidates) total += await visibleCount(candidate.locator)
  return total
}

function sanitize(value: string | null): string {
  if (!value) return 'missing'
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b\d{4,}\b/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72) || 'empty'
}

async function descriptor(locator: Locator): Promise<string> {
  const data = await locator.evaluate((element) => ({
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role'),
    aria: element.getAttribute('aria-label')
  })).catch(() => null)
  if (!data) return 'tag=detached;role=unknown;aria=missing'
  return `tag=${data.tag};role=${data.role ?? 'implicit/none'};aria=${sanitize(data.aria)}`
}

export class PageIdentitySwitcher {
  private readonly attempts: string[] = []
  private directAttempted = false
  private homeFallbackAttempted = false
  private targetName: string | null = null
  private currentStage: PageIdentityStage = 'page_surface'
  private allProfilesVerified = false

  constructor(
    private readonly page: Page,
    private readonly context: BrowserContext,
    private readonly browser: BrowserSettings,
    private readonly networkTimeoutMs = browser.navigationTimeoutMs
  ) {}

  private remember(value: string): void {
    if (this.attempts.length < MAX_DIAGNOSTIC_ATTEMPTS) {
      this.attempts.push(value.replace(/\s+/g, '_').slice(0, 180))
    }
  }

  private chooserRoots(): Locator {
    return this.page.locator('[role="menu"]:visible, [role="dialog"]:visible, [aria-modal="true"]:visible')
  }

  private dialogRoots(): Locator {
    return this.page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible')
  }

  private directCandidates(): NamedLocator[] {
    return [
      { strategy: 'switch-button', locator: this.page.getByRole('button', { name: DIRECT_SWITCH_PATTERN }) },
      { strategy: 'switch-link', locator: this.page.getByRole('link', { name: DIRECT_SWITCH_PATTERN }) },
      { strategy: 'switch-text', locator: this.page.getByText(DIRECT_SWITCH_PATTERN) }
    ]
  }

  private accountCandidates(): NamedLocator[] {
    return [
      { strategy: 'account-button', locator: this.page.getByRole('button', { name: ACCOUNT_MENU_PATTERN }) },
      { strategy: 'account-link', locator: this.page.getByRole('link', { name: ACCOUNT_MENU_PATTERN }) },
      { strategy: 'account-banner-menu-image', locator: this.page.locator('[role="banner"] [role="button"][aria-haspopup="menu"]:has(img)') },
      { strategy: 'account-banner-image', locator: this.page.locator('[role="banner"] [role="button"]:has(img)') }
    ]
  }

  private seeAllCandidates(root?: Locator): NamedLocator[] {
    const scope = root ?? this.page
    return [
      { strategy: root ? 'see-all-root-button' : 'see-all-button', locator: scope.getByRole('button', { name: SEE_ALL_PROFILES_PATTERN }) },
      { strategy: root ? 'see-all-root-menuitem' : 'see-all-menuitem', locator: scope.getByRole('menuitem', { name: SEE_ALL_PROFILES_PATTERN }) },
      { strategy: root ? 'see-all-root-link' : 'see-all-link', locator: scope.getByRole('link', { name: SEE_ALL_PROFILES_PATTERN }) },
      { strategy: root ? 'see-all-root-text' : 'see-all-text', locator: scope.getByText(SEE_ALL_PROFILES_PATTERN) }
    ]
  }

  private targetNamePattern(): RegExp | null {
    const name = normalizeText(this.targetName ?? '')
    if (!name) return null
    return new RegExp(`^${escapeRegex(name)}(?:\\s*(?:[·•|—–,:-]\\s*)?(?:page|profile|trang|trang cá nhân)\\b.*)?$`, 'i')
  }

  private targetCandidates(pageUid: string, stage: PageIdentityStage): NamedLocator[] {
    if (stage === 'page_surface') return []
    const uid = escapeCss(pageUid.trim())
    const pattern = this.targetNamePattern()
    const roots = this.chooserRoots()
    const candidates: NamedLocator[] = []

    if (uid) {
      const data = `[data-profileid="${uid}"],[data-profile-id="${uid}"],[data-pageid="${uid}"],[data-page-id="${uid}"]`
      candidates.push(
        { strategy: 'target-root-uid-link', locator: roots.locator(`a[href*="${uid}"]`) },
        { strategy: 'target-root-uid-data', locator: roots.locator(data) }
      )
      if (stage === 'all_profiles' && this.allProfilesVerified) {
        candidates.push(
          { strategy: 'target-page-uid-link', locator: this.page.locator(`a[href*="${uid}"]`) },
          { strategy: 'target-page-uid-data', locator: this.page.locator(data) }
        )
      }
    }

    if (pattern) {
      candidates.push(
        { strategy: 'target-root-name-menuitem', locator: roots.getByRole('menuitem', { name: pattern }) },
        { strategy: 'target-root-name-button', locator: roots.getByRole('button', { name: pattern }) },
        { strategy: 'target-root-name-link', locator: roots.getByRole('link', { name: pattern }) },
        { strategy: 'target-root-name-text', locator: roots.getByText(this.targetName!, { exact: true }) }
      )
      if (stage === 'all_profiles' && this.allProfilesVerified) {
        candidates.push(
          { strategy: 'target-page-name-menuitem', locator: this.page.getByRole('menuitem', { name: pattern }) },
          { strategy: 'target-page-name-button', locator: this.page.getByRole('button', { name: pattern }) },
          { strategy: 'target-page-name-link', locator: this.page.getByRole('link', { name: pattern }) },
          { strategy: 'target-page-name-text', locator: this.page.getByText(this.targetName!, { exact: true }) }
        )
      }
    }
    return candidates
  }

  private transitionTargetCandidates(pageUid: string): NamedLocator[] {
    const uid = escapeCss(pageUid.trim())
    const pattern = this.targetNamePattern()
    const candidates: NamedLocator[] = []
    if (uid) {
      const data = `[data-profileid="${uid}"],[data-profile-id="${uid}"],[data-pageid="${uid}"],[data-page-id="${uid}"]`
      candidates.push(
        { strategy: 'transition-uid-link', locator: this.page.locator(`a[href*="${uid}"]`) },
        { strategy: 'transition-uid-data', locator: this.page.locator(data) }
      )
    }
    if (pattern) {
      candidates.push(
        { strategy: 'transition-name-menuitem', locator: this.page.getByRole('menuitem', { name: pattern }) },
        { strategy: 'transition-name-button', locator: this.page.getByRole('button', { name: pattern }) },
        { strategy: 'transition-name-link', locator: this.page.getByRole('link', { name: pattern }) },
        { strategy: 'transition-name-text', locator: this.page.getByText(this.targetName!, { exact: true }) }
      )
    }
    return candidates
  }

  private async readTargetName(): Promise<string | null> {
    for (const candidate of [this.page.getByRole('heading', { level: 1 }), this.page.locator('h1')]) {
      const count = await candidate.count().catch(() => 0)
      for (let index = 0; index < count; index += 1) {
        const item = candidate.nth(index)
        if (!await item.isVisible().catch(() => false)) continue
        const text = normalizeText(await item.innerText().catch(() => ''))
        if (text && text.length <= 120) return text
      }
    }
    const meta = normalizeText((await this.page.locator('meta[property="og:title"]').first().getAttribute('content').catch(() => null)) ?? '')
    if (meta && meta.length <= 120) return meta
    const title = normalizeText((await this.page.title().catch(() => '')).replace(/\s*\|\s*Facebook\s*$/i, ''))
    return title && title.length <= 120 ? title : null
  }

  private async blocked(): Promise<PostingJobResult | null> {
    const state = await detectFacebookAccessBlock(this.page)
    if (state === 'login_required') return failure('needs_login', 'Facebook yêu cầu đăng nhập lại trong lúc chuyển Page.')
    if (state === 'verification_required') return failure('verification_required', 'Facebook yêu cầu checkpoint/xác minh thủ công trong lúc chuyển Page.')
    return null
  }

  private async identityMatches(pageUid: string, timeoutMs = this.networkTimeoutMs): Promise<boolean> {
    const deadline = Date.now() + Math.max(500, timeoutMs)
    while (Date.now() < deadline) {
      if (classifyPageIdentityUid(pageUid, await activeFacebookProfileId(this.context).catch(() => null)) === 'match') return true
      if (await detectFacebookAccessBlock(this.page)) return false
      await this.page.waitForTimeout(POLL_MS)
    }
    return false
  }

  private async settle(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded', { timeout: this.browser.navigationTimeoutMs }).catch(() => undefined)
    if (this.browser.pageSettleDelayMs > 0) {
      await this.page.waitForTimeout(this.browser.pageSettleDelayMs).catch(() => undefined)
    }
  }

  private async domClick(item: Locator): Promise<boolean> {
    return item.evaluate((element) => {
      if (element instanceof HTMLElement) {
        element.click()
        return true
      }
      return element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    }).then(() => true).catch(() => false)
  }

  private async clickFreshCandidates(
    action: string,
    buildCandidates: () => NamedLocator[],
    verify: VerifyClick,
    discoveryTimeoutMs = this.networkTimeoutMs
  ): Promise<boolean> {
    const discoveryDeadline = Date.now() + discoveryTimeoutMs
    while (Date.now() <= discoveryDeadline) {
      if (await countAcross(buildCandidates()) > 0) break
      await this.page.waitForTimeout(POLL_MS).catch(() => undefined)
    }

    const attempted = new Set<string>()
    for (let round = 0; round < MAX_ACTION_CANDIDATES; round += 1) {
      const candidates = buildCandidates()
      let candidateFound = false

      for (const candidate of candidates) {
        const count = await candidate.locator.count().catch(() => 0)
        const reverse = candidate.strategy.startsWith('account-banner-')
        for (let step = 0; step < count; step += 1) {
          const index = reverse ? count - 1 - step : step
          const item = candidate.locator.nth(index)
          if (!await item.isVisible().catch(() => false)) continue

          const info = await descriptor(item)
          const key = `${candidate.strategy}[${index}]:${info}`
          if (attempted.has(key)) continue
          attempted.add(key)
          candidateFound = true

          if (!await item.isEnabled().catch(() => true)) {
            this.remember(`${action}:${key}:disabled`)
            break
          }

          let clicked = await item.click({ timeout: this.networkTimeoutMs })
            .then(() => true)
            .catch(() => false)
          this.remember(`${action}:${key}:${clicked ? 'clicked' : 'click-failed'}`)
          if (!clicked) {
            clicked = await this.domClick(item)
            this.remember(`${action}:${key}:${clicked ? 'dom-clicked' : 'dom-click-failed'}`)
          }
          if (!clicked) break

          await this.settle()
          if (await verify()) return true

          this.remember(`${action}:${key}:no-postcondition`)
          await this.page.keyboard.press('Escape').catch(() => undefined)
          await this.page.waitForTimeout(POLL_MS).catch(() => undefined)
          break
        }
        if (candidateFound) break
      }

      if (!candidateFound) return false
    }
    return false
  }

  private async targetCounts(pageUid: string, stage: PageIdentityStage): Promise<{ uid: number; name: number }> {
    const candidates = this.targetCandidates(pageUid, stage)
    return {
      uid: await countAcross(candidates.filter((item) => item.strategy.includes('uid-'))),
      name: await countAcross(candidates.filter((item) => item.strategy.includes('name-')))
    }
  }

  private async transitionTargetCounts(pageUid: string): Promise<{ uid: number; name: number }> {
    const candidates = this.transitionTargetCandidates(pageUid)
    return {
      uid: await countAcross(candidates.filter((item) => item.strategy.includes('uid-'))),
      name: await countAcross(candidates.filter((item) => item.strategy.includes('name-')))
    }
  }

  private async chooserMarkerCount(): Promise<number> {
    return visibleCount(this.chooserRoots().getByText(CHOOSER_MARKER_PATTERN))
  }

  private async surfaceSnapshot(pageUid: string): Promise<PageIdentitySurfaceSnapshot> {
    const target = await this.transitionTargetCounts(pageUid)
    return {
      url: this.page.url(),
      chooserRootCount: await visibleCount(this.chooserRoots()),
      dialogCount: await visibleCount(this.dialogRoots()),
      chooserMarkerCount: await this.chooserMarkerCount(),
      targetUidCount: target.uid,
      targetNameCount: target.name,
      seeAllProfilesCount: await countAcross(this.seeAllCandidates())
    }
  }

  private async verifyChooser(pageUid: string, beforePageWideSeeAllCount: number): Promise<boolean> {
    const deadline = Date.now() + this.networkTimeoutMs
    while (Date.now() < deadline) {
      if (await countAcross(this.seeAllCandidates(this.chooserRoots())) > 0) return true
      const target = await this.targetCounts(pageUid, 'account_menu')
      if (target.uid > 0 || target.name > 0) return true
      if (await this.chooserMarkerCount() > 0) return true
      if (await countAcross(this.seeAllCandidates()) > beforePageWideSeeAllCount) return true
      await this.page.waitForTimeout(POLL_MS)
    }
    return false
  }

  private async verifySurfaceAdvance(pageUid: string, before: PageIdentitySurfaceSnapshot): Promise<boolean> {
    const deadline = Date.now() + this.networkTimeoutMs
    while (Date.now() < deadline) {
      if (pageIdentitySurfaceAdvanced(before, await this.surfaceSnapshot(pageUid))) return true
      await this.page.waitForTimeout(POLL_MS)
    }
    return false
  }

  private async tryDirect(pageUid: string): Promise<PostingJobResult | null> {
    this.directAttempted = true
    const matched = await this.clickFreshCandidates(
      'direct',
      () => this.directCandidates(),
      () => this.identityMatches(pageUid),
      this.networkTimeoutMs
    )
    if (matched) return { status: 'success', message: 'Đã chuyển sang Page identity bằng direct switch và xác minh i_user.' }
    return (await this.blocked()) ?? null
  }

  private async selectTarget(pageUid: string, stage: PageIdentityStage): Promise<PostingJobResult | null> {
    const matched = await this.clickFreshCandidates(
      'select-target',
      () => this.targetCandidates(pageUid, stage),
      () => this.identityMatches(pageUid),
      this.networkTimeoutMs
    )
    if (matched) return { status: 'success', message: 'Đã chọn Page trong profile chooser và xác minh i_user đúng Page UID.' }
    return (await this.blocked()) ?? null
  }

  private async runChooser(pageUid: string): Promise<PostingJobResult | null> {
    this.currentStage = 'account_menu'
    this.allProfilesVerified = false

    const directTarget = await this.selectTarget(pageUid, 'account_menu')
    if (directTarget) return directTarget

    const root = this.chooserRoots()
    const scopedSeeAll = await countAcross(this.seeAllCandidates(root))
    const pageWideSeeAll = await countAcross(this.seeAllCandidates())
    if (scopedSeeAll === 0 && pageWideSeeAll === 0) return null

    const before = await this.surfaceSnapshot(pageUid)
    const opened = await this.clickFreshCandidates(
      'see-all',
      () => scopedSeeAll > 0 ? this.seeAllCandidates(this.chooserRoots()) : this.seeAllCandidates(),
      () => this.verifySurfaceAdvance(pageUid, before)
    )
    if (!opened) return null

    this.allProfilesVerified = true
    this.currentStage = 'all_profiles'
    return this.selectTarget(pageUid, 'all_profiles')
  }

  private async openChooser(pageUid: string): Promise<boolean> {
    const beforeSeeAll = await countAcross(this.seeAllCandidates())
    return this.clickFreshCandidates(
      'open-account-menu',
      () => this.accountCandidates(),
      () => this.verifyChooser(pageUid, beforeSeeAll)
    )
  }

  private async openHome(): Promise<PostingJobResult | null> {
    this.homeFallbackAttempted = true
    this.remember('home-fallback')
    try {
      await this.page.goto('https://www.facebook.com/', {
        waitUntil: 'domcontentloaded',
        timeout: this.browser.navigationTimeoutMs
      })
      if (this.browser.pageSettleDelayMs > 0) await this.page.waitForTimeout(this.browser.pageSettleDelayMs)
    } catch (error) {
      return failure('page_navigation_failed', `Không mở được Facebook home để chuyển Page: ${error instanceof Error ? error.message : String(error)}`)
    }
    return this.blocked()
  }

  private async diagnostics(pageUid: string): Promise<string> {
    const active = await activeFacebookProfileId(this.context).catch(() => null)
    const target = await this.targetCounts(pageUid, this.currentStage)
    return formatPageIdentityDiagnostics({
      stage: this.currentStage,
      uidState: classifyPageIdentityUid(pageUid, active),
      directSwitchCount: await countAcross(this.directCandidates()),
      accountMenuCount: await countAcross(this.accountCandidates()),
      seeAllProfilesCount: await countAcross(this.seeAllCandidates()),
      targetUidCount: target.uid,
      targetNameCount: target.name,
      directAttempted: this.directAttempted,
      homeFallbackAttempted: this.homeFallbackAttempted,
      targetNameAvailable: Boolean(this.targetName),
      candidateAttempts: [...this.attempts],
      url: this.page.url()
    })
  }

  async switchTo(pageUid: string): Promise<PostingJobResult> {
    const uid = pageUid.trim()

    const managedPages = await tryManagedPagesSwitch(
      this.page,
      this.context,
      this.browser,
      uid,
      this.networkTimeoutMs
    )
    this.remember(`managed-pages:${managedPages.diagnostic}`)
    if (managedPages.result) return managedPages.result

    try {
      await this.page.goto(`https://www.facebook.com/${encodeURIComponent(uid)}`, {
        waitUntil: 'domcontentloaded',
        timeout: this.browser.navigationTimeoutMs
      })
      if (this.browser.pageSettleDelayMs > 0) await this.page.waitForTimeout(this.browser.pageSettleDelayMs)
    } catch (error) {
      return failure('page_navigation_failed', error instanceof Error ? error.message : String(error))
    }

    const initialBlock = await this.blocked()
    if (initialBlock) return initialBlock
    if (await this.identityMatches(uid, 500)) return { status: 'success', message: 'Page identity đã active và khớp i_user.' }

    this.targetName = await this.readTargetName()
    const direct = await this.tryDirect(uid)
    if (direct) return direct

    if (await this.openChooser(uid)) {
      const chooserResult = await this.runChooser(uid)
      if (chooserResult) return chooserResult
    }

    if (await this.identityMatches(uid, 1_500)) {
      return { status: 'success', message: 'Page identity đã chuyển chậm nhưng đã xác minh i_user trước Home fallback.' }
    }

    if (shouldEndPageIdentityForUnavailableAccess(managedPages.targetPresence, true)) {
      this.remember('page-access-unavailable:first-pass')
      return failure(
        'page_access_unavailable',
        'Tài khoản không quản lý hoặc không còn quyền truy cập Page này; không thể switch Page.'
      )
    }

    const homeFailure = await this.openHome()
    if (homeFailure) return homeFailure
    this.currentStage = 'page_surface'

    if (await this.identityMatches(uid, 1_500)) {
      return { status: 'success', message: 'Page identity đã xác minh i_user sau Home transition.' }
    }

    if (await this.openChooser(uid)) {
      const chooserResult = await this.runChooser(uid)
      if (chooserResult) return chooserResult
    }

    return failure(
      'page_identity_unconfirmed',
      `Không chuyển được Page sau managed Pages route, direct path và một lần Home fallback. ${await this.diagnostics(uid)}`
    )
  }
}
