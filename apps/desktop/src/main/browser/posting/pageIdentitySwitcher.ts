import type { BrowserContext, Locator, Page } from 'playwright-core'
import type { BrowserSettings } from '../../../shared/appSettings'
import type { PostingJobResult } from '../../../shared/posting'
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

export interface PageIdentityDiagnostics {
  stage: PageIdentityStage
  uidState: PageIdentityUidState
  directSwitchCount: number
  accountMenuCount: number
  seeAllProfilesCount: number
  targetUidCount: number
  targetNameCount: number
  directAttempted: boolean
  homeFallbackAttempted: boolean
  targetNameAvailable: boolean
  candidateAttempts: string[]
  url: string
}

type PostingCode = NonNullable<PostingJobResult['code']>
type IdentityWaitResult = 'matched' | 'login_required' | 'verification_required' | 'timeout'

interface NamedLocator {
  strategy: string
  locator: Locator
}

const DIRECT_SWITCH_PATTERN = /switch now|switch into(?: this page)?|switch to(?: this page)?|chuyển ngay|chuyển sang(?: trang này)?/i
const SEE_ALL_PROFILES_PATTERN = /see all profiles|xem tất cả trang cá nhân|xem tất cả hồ sơ|xem tất cả trang/i
const ACCOUNT_MENU_PATTERN = /^(?:your profile|profile picture|account controls|account menu|account|tài khoản|menu tài khoản|ảnh đại diện|trang cá nhân)$/i
const ACTION_SETTLE_MS = 700
const IDENTITY_POLL_MS = 250
const MAX_DIAGNOSTIC_ATTEMPTS = 16

function failure(code: PostingCode, message: string): PostingJobResult {
  return {
    status: code === 'needs_login' || code === 'verification_required' ? 'needs_login' : 'failed',
    code,
    message
  }
}

export function classifyPageIdentityUid(expectedPageUid: string, activeProfileId: string | null | undefined): PageIdentityUidState {
  const expected = expectedPageUid.trim()
  const active = activeProfileId?.trim() || null
  if (!active) return 'missing'
  return active === expected ? 'match' : 'other'
}

export function isAccountMenuAccessibleName(value: string): boolean {
  return ACCOUNT_MENU_PATTERN.test(value.trim())
}

export function targetIdentityScope(stage: PageIdentityStage): 'none' | 'overlay-only' | 'verified-all-profiles-surface' {
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
    if (evidence.seeAllProfilesCount > 0) return 'click_see_all_profiles'
    if (evidence.targetNameCount > 0) return 'select_target_name'
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
    `attempts=${input.candidateAttempts.length > 0 ? input.candidateAttempts.join(',') : 'none'}`,
    `url=${safePageIdentityUrl(input.url)}`
  ].join(' ')
}

async function visibleCount(candidate: Locator): Promise<number> {
  const count = await candidate.count().catch(() => 0)
  let visible = 0
  for (let index = 0; index < count; index += 1) {
    if (await candidate.nth(index).isVisible().catch(() => false)) visible += 1
  }
  return visible
}

async function visibleCountAcross(candidates: NamedLocator[]): Promise<number> {
  let total = 0
  for (const candidate of candidates) total += await visibleCount(candidate.locator)
  return total
}

function escapeCssAttribute(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sanitizeAttribute(value: string | null): string {
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

async function locatorDescriptor(locator: Locator): Promise<string> {
  const metadata = await locator.evaluate((element) => ({
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role'),
    ariaLabel: element.getAttribute('aria-label')
  })).catch(() => null)
  if (!metadata) return 'tag=detached;role=unknown;aria=missing'
  return `tag=${metadata.tag};role=${metadata.role ?? 'implicit/none'};aria=${sanitizeAttribute(metadata.ariaLabel)}`
}

export class PageIdentitySwitcher {
  private readonly seenCounts = {
    directSwitchCount: 0,
    accountMenuCount: 0,
    seeAllProfilesCount: 0,
    targetUidCount: 0,
    targetNameCount: 0
  }
  private readonly candidateAttempts: string[] = []

  constructor(
    private readonly page: Page,
    private readonly context: BrowserContext,
    private readonly browser: BrowserSettings
  ) {}

  private rememberAttempt(value: string): void {
    if (this.candidateAttempts.length >= MAX_DIAGNOSTIC_ATTEMPTS) return
    this.candidateAttempts.push(value.replace(/\s+/g, '_').slice(0, 180))
  }

  private directSwitchCandidates(): NamedLocator[] {
    return [
      { strategy: 'direct-role-button', locator: this.page.getByRole('button', { name: DIRECT_SWITCH_PATTERN }) },
      { strategy: 'direct-role-link', locator: this.page.getByRole('link', { name: DIRECT_SWITCH_PATTERN }) },
      { strategy: 'direct-role-button-text', locator: this.page.locator('[role="button"]').filter({ hasText: DIRECT_SWITCH_PATTERN }) },
      { strategy: 'direct-text', locator: this.page.getByText(DIRECT_SWITCH_PATTERN) }
    ]
  }

  private accountMenuCandidates(): NamedLocator[] {
    return [
      { strategy: 'account-semantic-button', locator: this.page.getByRole('button', { name: ACCOUNT_MENU_PATTERN }) },
      { strategy: 'account-semantic-link', locator: this.page.getByRole('link', { name: ACCOUNT_MENU_PATTERN }) },
      { strategy: 'account-banner-menu-image', locator: this.page.locator('[role="banner"] [role="button"][aria-haspopup="menu"]:has(img)').last() },
      { strategy: 'account-banner-image', locator: this.page.locator('[role="banner"] [role="button"]:has(img)').last() },
      { strategy: 'account-header-image', locator: this.page.locator('header [role="button"]:has(img)').last() },
      { strategy: 'account-navigation-image', locator: this.page.locator('[role="navigation"] [role="button"]:has(img)').last() }
    ]
  }

  private seeAllProfilesCandidates(): NamedLocator[] {
    return [
      { strategy: 'see-all-role-button', locator: this.page.getByRole('button', { name: SEE_ALL_PROFILES_PATTERN }) },
      { strategy: 'see-all-menuitem', locator: this.page.getByRole('menuitem', { name: SEE_ALL_PROFILES_PATTERN }) },
      { strategy: 'see-all-role-link', locator: this.page.getByRole('link', { name: SEE_ALL_PROFILES_PATTERN }) },
      { strategy: 'see-all-text', locator: this.page.getByText(SEE_ALL_PROFILES_PATTERN) }
    ]
  }

  private chooserOverlays(): Locator {
    return this.page.locator('[role="menu"]:visible, [role="dialog"]:visible, [aria-modal="true"]:visible')
  }

  private targetUidCandidates(pageUid: string, stage: PageIdentityStage): NamedLocator[] {
    const uid = escapeCssAttribute(pageUid.trim())
    if (!uid || stage === 'page_surface') return []
    const dataSelector = `[data-profileid="${uid}"], [data-profile-id="${uid}"], [data-pageid="${uid}"], [data-page-id="${uid}"]`
    const overlays = this.chooserOverlays()
    const scoped: NamedLocator[] = [
      { strategy: 'target-uid-overlay-link', locator: overlays.locator(`a[href*="${uid}"]`) },
      { strategy: 'target-uid-overlay-data', locator: overlays.locator(dataSelector) }
    ]
    if (stage === 'account_menu') return scoped

    // Page-wide UID lookup is allowed only after the state machine has successfully
    // opened Facebook's explicit all-profiles surface; never from the account menu.
    return [
      ...scoped,
      { strategy: 'target-uid-all-profiles-link', locator: this.page.locator(`a[href*="${uid}"]`) },
      { strategy: 'target-uid-all-profiles-data', locator: this.page.locator(dataSelector) }
    ]
  }

  private targetNameCandidates(targetName: string | null, stage: PageIdentityStage): NamedLocator[] {
    const normalized = targetName?.trim()
    if (!normalized || stage === 'page_surface') return []
    const exact = new RegExp(`^${escapeRegex(normalized)}$`, 'i')
    const overlays = this.chooserOverlays()
    const scoped: NamedLocator[] = [
      { strategy: 'target-name-overlay-menuitem', locator: overlays.getByRole('menuitem', { name: exact }) },
      { strategy: 'target-name-overlay-button', locator: overlays.getByRole('button', { name: exact }) },
      { strategy: 'target-name-overlay-link', locator: overlays.getByRole('link', { name: exact }) }
    ]
    if (stage === 'account_menu') return scoped

    return [
      ...scoped,
      { strategy: 'target-name-all-profiles-menuitem', locator: this.page.getByRole('menuitem', { name: exact }) },
      { strategy: 'target-name-all-profiles-button', locator: this.page.getByRole('button', { name: exact }) },
      { strategy: 'target-name-all-profiles-link', locator: this.page.getByRole('link', { name: exact }) },
      { strategy: 'target-name-all-profiles-text', locator: this.page.getByText(normalized, { exact: true }) }
    ]
  }

  private async readTargetPageName(): Promise<string | null> {
    const headings = [
      this.page.getByRole('heading', { level: 1 }),
      this.page.locator('h1')
    ]
    for (const candidate of headings) {
      const count = await candidate.count().catch(() => 0)
      for (let index = 0; index < count; index += 1) {
        const item = candidate.nth(index)
        if (!await item.isVisible().catch(() => false)) continue
        const headingText = (await item.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        if (headingText && headingText.length <= 120) return headingText
      }
    }

    const ogTitle = (await this.page.locator('meta[property="og:title"]').first().getAttribute('content').catch(() => null))?.trim()
    if (ogTitle && ogTitle.length <= 120) return ogTitle

    const title = (await this.page.title().catch(() => '')).replace(/\s*\|\s*Facebook\s*$/i, '').trim()
    return title && title.length <= 120 ? title : null
  }

  private async waitForExpectedIdentity(pageUid: string, timeoutMs: number): Promise<IdentityWaitResult> {
    const deadline = Date.now() + Math.max(500, timeoutMs)
    while (Date.now() < deadline) {
      const blocked = await detectFacebookAccessBlock(this.page)
      if (blocked === 'login_required') return 'login_required'
      if (blocked === 'verification_required') return 'verification_required'
      const active = await activeFacebookProfileId(this.context).catch(() => null)
      if (classifyPageIdentityUid(pageUid, active) === 'match') return 'matched'
      await this.page.waitForTimeout(IDENTITY_POLL_MS)
    }
    return 'timeout'
  }

  private blockedResult(state: IdentityWaitResult, suffix = ''): PostingJobResult | null {
    if (state === 'login_required') return failure('needs_login', `Facebook yêu cầu đăng nhập lại${suffix}.`)
    if (state === 'verification_required') return failure('verification_required', `Facebook yêu cầu checkpoint/xác minh thủ công${suffix}.`)
    return null
  }

  private mergeSeen(evidence: PageIdentityEvidence): void {
    this.seenCounts.directSwitchCount = Math.max(this.seenCounts.directSwitchCount, evidence.directSwitchCount)
    this.seenCounts.accountMenuCount = Math.max(this.seenCounts.accountMenuCount, evidence.accountMenuCount)
    this.seenCounts.seeAllProfilesCount = Math.max(this.seenCounts.seeAllProfilesCount, evidence.seeAllProfilesCount)
    this.seenCounts.targetUidCount = Math.max(this.seenCounts.targetUidCount, evidence.targetUidCount)
    this.seenCounts.targetNameCount = Math.max(this.seenCounts.targetNameCount, evidence.targetNameCount)
  }

  private async collectEvidence(
    stage: PageIdentityStage,
    pageUid: string,
    targetName: string | null,
    directAttempted: boolean
  ): Promise<PageIdentityEvidence> {
    const active = await activeFacebookProfileId(this.context).catch(() => null)
    const evidence: PageIdentityEvidence = {
      stage,
      uidState: classifyPageIdentityUid(pageUid, active),
      directSwitchCount: await visibleCountAcross(this.directSwitchCandidates()),
      accountMenuCount: await visibleCountAcross(this.accountMenuCandidates()),
      seeAllProfilesCount: await visibleCountAcross(this.seeAllProfilesCandidates()),
      targetUidCount: await visibleCountAcross(this.targetUidCandidates(pageUid, stage)),
      targetNameCount: await visibleCountAcross(this.targetNameCandidates(targetName, stage)),
      directAttempted
    }
    this.mergeSeen(evidence)
    return evidence
  }

  private diagnosticMessage(
    stage: PageIdentityStage,
    pageUid: string,
    targetName: string | null,
    directAttempted: boolean,
    homeFallbackAttempted: boolean
  ): Promise<string> {
    return activeFacebookProfileId(this.context).catch(() => null).then((active) => formatPageIdentityDiagnostics({
      stage,
      uidState: classifyPageIdentityUid(pageUid, active),
      ...this.seenCounts,
      directAttempted,
      homeFallbackAttempted,
      targetNameAvailable: Boolean(targetName),
      candidateAttempts: [...this.candidateAttempts],
      url: this.page.url()
    }))
  }

  private async settleAction(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined)
    await this.page.waitForTimeout(ACTION_SETTLE_MS)
  }

  private async openHomeSurface(reason: string): Promise<PostingJobResult | null> {
    this.rememberAttempt(`home-fallback:${reason}`)
    try {
      await this.page.goto('https://www.facebook.com/', {
        waitUntil: 'domcontentloaded',
        timeout: this.browser.navigationTimeoutMs
      })
      if (this.browser.pageSettleDelayMs > 0) await this.page.waitForTimeout(this.browser.pageSettleDelayMs)
    } catch (error) {
      return failure('page_navigation_failed', `Không mở được Facebook home để tìm profile chooser: ${error instanceof Error ? error.message : String(error)}`)
    }

    const blocked = await detectFacebookAccessBlock(this.page)
    if (blocked === 'login_required') return failure('needs_login', 'Facebook yêu cầu đăng nhập lại khi mở home để chuyển Page.')
    if (blocked === 'verification_required') return failure('verification_required', 'Facebook yêu cầu checkpoint/xác minh thủ công khi mở home để chuyển Page.')
    return null
  }

  private async tryClickCandidates(action: PageIdentityAction, candidates: NamedLocator[]): Promise<boolean> {
    for (const candidate of candidates) {
      const count = await candidate.locator.count().catch(() => 0)
      for (let index = 0; index < count; index += 1) {
        const item = candidate.locator.nth(index)
        if (!await item.isVisible().catch(() => false)) continue
        const descriptor = await locatorDescriptor(item)
        if (!await item.isEnabled().catch(() => true)) {
          this.rememberAttempt(`${action}:${candidate.strategy}[${index}]:disabled:${descriptor}`)
          continue
        }

        const clicked = await item.click({ timeout: Math.min(this.browser.navigationTimeoutMs, 6_000) })
          .then(() => true)
          .catch(() => false)
        this.rememberAttempt(`${action}:${candidate.strategy}[${index}]:${clicked ? 'clicked' : 'click-failed'}:${descriptor}`)
        if (clicked) return true
      }
    }
    return false
  }

  private candidatesForAction(
    action: PageIdentityAction,
    pageUid: string,
    targetName: string | null,
    stage: PageIdentityStage
  ): NamedLocator[] {
    if (action === 'click_direct_switch') return this.directSwitchCandidates()
    if (action === 'open_account_menu') return this.accountMenuCandidates()
    if (action === 'click_see_all_profiles') return this.seeAllProfilesCandidates()
    if (action === 'select_target_uid') return this.targetUidCandidates(pageUid, stage)
    if (action === 'select_target_name') return this.targetNameCandidates(targetName, stage)
    return []
  }

  async switchTo(pageUid: string): Promise<PostingJobResult> {
    const normalizedUid = pageUid.trim()
    try {
      await this.page.goto(`https://www.facebook.com/${encodeURIComponent(normalizedUid)}`, {
        waitUntil: 'domcontentloaded',
        timeout: this.browser.navigationTimeoutMs
      })
      if (this.browser.pageSettleDelayMs > 0) await this.page.waitForTimeout(this.browser.pageSettleDelayMs)
    } catch (error) {
      return failure('page_navigation_failed', error instanceof Error ? error.message : String(error))
    }

    const initialBlock = await detectFacebookAccessBlock(this.page)
    if (initialBlock === 'login_required') return failure('needs_login', 'Facebook yêu cầu đăng nhập lại khi mở Page.')
    if (initialBlock === 'verification_required') return failure('verification_required', 'Facebook yêu cầu checkpoint/xác minh thủ công khi mở Page.')

    const targetName = await this.readTargetPageName()
    let stage: PageIdentityStage = 'page_surface'
    let directAttempted = false
    let homeFallbackAttempted = false

    for (let step = 0; step < 10; step += 1) {
      const blocked = await detectFacebookAccessBlock(this.page)
      if (blocked === 'login_required') return failure('needs_login', 'Facebook yêu cầu đăng nhập lại trong lúc chuyển Page.')
      if (blocked === 'verification_required') return failure('verification_required', 'Facebook yêu cầu checkpoint/xác minh thủ công trong lúc chuyển Page.')

      const evidence = await this.collectEvidence(stage, normalizedUid, targetName, directAttempted)
      const action = resolvePageIdentityAction(evidence)
      if (action === 'success') {
        return { status: 'success', message: 'Page identity đã active và khớp i_user.' }
      }
      if (action === 'fail') {
        if (shouldRetryPageIdentityFromHome(evidence, homeFallbackAttempted)) {
          homeFallbackAttempted = true
          const homeFailure = await this.openHomeSurface(`no-control-${stage}`)
          if (homeFailure) return homeFailure
          stage = 'page_surface'
          continue
        }
        const diagnostics = await this.diagnosticMessage(stage, normalizedUid, targetName, directAttempted, homeFallbackAttempted)
        return failure('page_identity_unconfirmed', `Không xác minh được Page identity. ${diagnostics}`)
      }

      if (action === 'click_direct_switch') directAttempted = true
      const clicked = await this.tryClickCandidates(action, this.candidatesForAction(action, normalizedUid, targetName, stage))
      if (!clicked) {
        if (action === 'click_direct_switch') continue
        if (shouldRetryPageIdentityAfterControlFailure(action, stage, homeFallbackAttempted)) {
          homeFallbackAttempted = true
          const homeFailure = await this.openHomeSurface(`${action}-candidates-exhausted`)
          if (homeFailure) return homeFailure
          stage = 'page_surface'
          continue
        }
        const diagnostics = await this.diagnosticMessage(stage, normalizedUid, targetName, directAttempted, homeFallbackAttempted)
        return failure('page_identity_unconfirmed', `Không thể click bất kỳ candidate hợp lệ cho control ${action}. ${diagnostics}`)
      }

      await this.settleAction()

      if (action === 'click_direct_switch') {
        const waited = await this.waitForExpectedIdentity(normalizedUid, Math.min(this.browser.navigationTimeoutMs, 10_000))
        const blockedResult = this.blockedResult(waited, ' sau khi bấm switch trực tiếp')
        if (blockedResult) return blockedResult
        if (waited === 'matched') return { status: 'success', message: 'Đã chuyển sang Page identity bằng control trực tiếp và xác minh i_user.' }
        stage = 'page_surface'
        continue
      }

      if (action === 'open_account_menu') {
        stage = 'account_menu'
        continue
      }
      if (action === 'click_see_all_profiles') {
        stage = 'all_profiles'
        continue
      }

      const waited = await this.waitForExpectedIdentity(normalizedUid, Math.min(this.browser.navigationTimeoutMs, 12_000))
      const blockedResult = this.blockedResult(waited, ' sau khi chọn Page trong profile chooser')
      if (blockedResult) return blockedResult
      if (waited === 'matched') {
        return { status: 'success', message: 'Đã chọn Page trong profile chooser và xác minh i_user đúng Page UID.' }
      }

      const diagnostics = await this.diagnosticMessage(stage, normalizedUid, targetName, directAttempted, homeFallbackAttempted)
      return failure('page_identity_unconfirmed', `Đã chọn Page nhưng i_user chưa chuyển sang Page UID yêu cầu. ${diagnostics}`)
    }

    const diagnostics = await this.diagnosticMessage(stage, normalizedUid, targetName, directAttempted, homeFallbackAttempted)
    return failure('page_identity_unconfirmed', `Hết số bước state machine chuyển Page mà chưa xác minh được identity. ${diagnostics}`)
  }
}
