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

export interface PageIdentityDiagnostics extends PageIdentityEvidence {
  homeFallbackAttempted: boolean
  targetNameAvailable: boolean
  candidateAttempts: string[]
  url: string
}

type PostingCode = NonNullable<PostingJobResult['code']>
type IdentityWaitResult = 'matched' | 'login_required' | 'verification_required' | 'timeout'
type VerifyClick = () => Promise<boolean>

interface NamedLocator {
  strategy: string
  locator: Locator
}

const DIRECT_SWITCH_PATTERN = /switch now|switch into(?: this page)?|switch to(?: this page)?|chuyển ngay|chuyển sang(?: trang này)?/i
const SEE_ALL_PROFILES_PATTERN = /see all profiles|xem tất cả trang cá nhân|xem tất cả hồ sơ|xem tất cả trang/i
const ACCOUNT_MENU_PATTERN = /^(?:your profile(?:\b.*)?|profile picture(?:\b.*)?|account controls(?:\b.*)?|account menu(?:\b.*)?|account|tài khoản|menu tài khoản|ảnh đại diện(?:\b.*)?|trang cá nhân(?:\b.*)?)$/i
const PROFILE_CHOOSER_PATTERN = /see all profiles|switch profile|your profiles|profiles and pages|xem tất cả trang cá nhân|xem tất cả hồ sơ|chuyển trang cá nhân|trang và trang cá nhân/i
const ACTION_SETTLE_MS = 700
const POLL_MS = 250
const SURFACE_TIMEOUT_MS = 3_000
const MAX_ATTEMPTS = 20

function failure(code: PostingCode, message: string): PostingJobResult {
  return {
    status: code === 'needs_login' || code === 'verification_required' ? 'needs_login' : 'failed',
    code,
    message
  }
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

export function isAccountMenuAccessibleName(value: string): boolean {
  return ACCOUNT_MENU_PATTERN.test(value.replace(/\s+/g, ' ').trim())
}

export function isDirectSwitchAccessibleName(value: string): boolean {
  return DIRECT_SWITCH_PATTERN.test(value.replace(/\s+/g, ' ').trim())
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

export function pageIdentityActionRequiresSurfaceVerification(action: PageIdentityAction): boolean {
  return action === 'open_account_menu' || action === 'click_see_all_profiles'
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

function escapeCss(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

  constructor(
    private readonly page: Page,
    private readonly context: BrowserContext,
    private readonly browser: BrowserSettings
  ) {}

  private remember(value: string): void {
    if (this.attempts.length < MAX_ATTEMPTS) this.attempts.push(value.replace(/\s+/g, '_').slice(0, 180))
  }

  private directCandidates(): NamedLocator[] {
    return [
      { strategy: 'legacy-switch-now', locator: this.page.getByRole('button', { name: /switch now|chuyển ngay/i }).first() },
      { strategy: 'legacy-switch-into', locator: this.page.getByRole('button', { name: /switch into|chuyển sang/i }).first() },
      { strategy: 'legacy-switch-text', locator: this.page.getByText(/switch into this page|chuyển sang trang này/i).first() },
      { strategy: 'direct-role-button', locator: this.page.getByRole('button', { name: DIRECT_SWITCH_PATTERN }) },
      { strategy: 'direct-role-link', locator: this.page.getByRole('link', { name: DIRECT_SWITCH_PATTERN }) },
      { strategy: 'direct-text', locator: this.page.getByText(DIRECT_SWITCH_PATTERN) }
    ]
  }

  private accountCandidates(): NamedLocator[] {
    return [
      { strategy: 'account-semantic-button', locator: this.page.getByRole('button', { name: ACCOUNT_MENU_PATTERN }) },
      { strategy: 'account-semantic-link', locator: this.page.getByRole('link', { name: ACCOUNT_MENU_PATTERN }) },
      { strategy: 'account-banner-menu-image', locator: this.page.locator('[role="banner"] [role="button"][aria-haspopup="menu"]:has(img)') },
      { strategy: 'account-banner-image', locator: this.page.locator('[role="banner"] [role="button"]:has(img)') }
    ]
  }

  private seeAllCandidates(): NamedLocator[] {
    return [
      { strategy: 'see-all-role-button', locator: this.page.getByRole('button', { name: SEE_ALL_PROFILES_PATTERN }) },
      { strategy: 'see-all-menuitem', locator: this.page.getByRole('menuitem', { name: SEE_ALL_PROFILES_PATTERN }) },
      { strategy: 'see-all-role-link', locator: this.page.getByRole('link', { name: SEE_ALL_PROFILES_PATTERN }) },
      { strategy: 'see-all-text', locator: this.page.getByText(SEE_ALL_PROFILES_PATTERN) }
    ]
  }

  private overlays(): Locator {
    return this.page.locator('[role="menu"]:visible, [role="dialog"]:visible, [aria-modal="true"]:visible')
  }

  private uidCandidates(pageUid: string, stage: PageIdentityStage): NamedLocator[] {
    if (stage === 'page_surface') return []
    const uid = escapeCss(pageUid.trim())
    if (!uid) return []
    const data = `[data-profileid="${uid}"],[data-profile-id="${uid}"],[data-pageid="${uid}"],[data-page-id="${uid}"]`
    const overlay = this.overlays()
    const scoped: NamedLocator[] = [
      { strategy: 'target-uid-overlay-link', locator: overlay.locator(`a[href*="${uid}"]`) },
      { strategy: 'target-uid-overlay-data', locator: overlay.locator(data) }
    ]
    return stage === 'account_menu'
      ? scoped
      : [
          ...scoped,
          { strategy: 'target-uid-all-link', locator: this.page.locator(`a[href*="${uid}"]`) },
          { strategy: 'target-uid-all-data', locator: this.page.locator(data) }
        ]
  }

  private nameCandidates(stage: PageIdentityStage): NamedLocator[] {
    const name = this.targetName?.trim()
    if (!name || stage === 'page_surface') return []
    const exact = new RegExp(`^${escapeRegex(name)}$`, 'i')
    const overlay = this.overlays()
    const scoped: NamedLocator[] = [
      { strategy: 'target-name-overlay-menuitem', locator: overlay.getByRole('menuitem', { name: exact }) },
      { strategy: 'target-name-overlay-button', locator: overlay.getByRole('button', { name: exact }) },
      { strategy: 'target-name-overlay-link', locator: overlay.getByRole('link', { name: exact }) },
      { strategy: 'target-name-overlay-text', locator: overlay.getByText(name, { exact: true }) }
    ]
    return stage === 'account_menu'
      ? scoped
      : [
          ...scoped,
          { strategy: 'target-name-all-menuitem', locator: this.page.getByRole('menuitem', { name: exact }) },
          { strategy: 'target-name-all-button', locator: this.page.getByRole('button', { name: exact }) },
          { strategy: 'target-name-all-link', locator: this.page.getByRole('link', { name: exact }) },
          { strategy: 'target-name-all-text', locator: this.page.getByText(name, { exact: true }) }
        ]
  }

  private async readTargetName(): Promise<string | null> {
    for (const candidate of [this.page.getByRole('heading', { level: 1 }), this.page.locator('h1')]) {
      const count = await candidate.count().catch(() => 0)
      for (let index = 0; index < count; index += 1) {
        const item = candidate.nth(index)
        if (!await item.isVisible().catch(() => false)) continue
        const text = (await item.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        if (text && text.length <= 120) return text
      }
    }
    const meta = (await this.page.locator('meta[property="og:title"]').first().getAttribute('content').catch(() => null))?.trim()
    if (meta && meta.length <= 120) return meta
    const title = (await this.page.title().catch(() => '')).replace(/\s*\|\s*Facebook\s*$/i, '').trim()
    return title && title.length <= 120 ? title : null
  }

  private async blocked(): Promise<PostingJobResult | null> {
    const state = await detectFacebookAccessBlock(this.page)
    if (state === 'login_required') return failure('needs_login', 'Facebook yêu cầu đăng nhập lại trong lúc chuyển Page.')
    if (state === 'verification_required') return failure('verification_required', 'Facebook yêu cầu checkpoint/xác minh thủ công trong lúc chuyển Page.')
    return null
  }

  private async waitIdentity(pageUid: string, timeoutMs: number): Promise<IdentityWaitResult> {
    const deadline = Date.now() + Math.max(500, timeoutMs)
    while (Date.now() < deadline) {
      const blocked = await detectFacebookAccessBlock(this.page)
      if (blocked === 'login_required') return 'login_required'
      if (blocked === 'verification_required') return 'verification_required'
      const active = await activeFacebookProfileId(this.context).catch(() => null)
      if (classifyPageIdentityUid(pageUid, active) === 'match') return 'matched'
      await this.page.waitForTimeout(POLL_MS)
    }
    return 'timeout'
  }

  private waitFailure(waited: IdentityWaitResult, suffix: string): PostingJobResult | null {
    if (waited === 'login_required') return failure('needs_login', `Facebook yêu cầu đăng nhập lại${suffix}.`)
    if (waited === 'verification_required') return failure('verification_required', `Facebook yêu cầu checkpoint/xác minh thủ công${suffix}.`)
    return null
  }

  private async settle(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined)
    await this.page.waitForTimeout(ACTION_SETTLE_MS).catch(() => undefined)
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

  private async clickCandidates(
    action: string,
    candidates: NamedLocator[],
    verify?: VerifyClick
  ): Promise<boolean> {
    for (const candidate of candidates) {
      const count = await candidate.locator.count().catch(() => 0)
      const reverse = candidate.strategy.startsWith('account-banner-')
      for (let step = 0; step < count; step += 1) {
        const index = reverse ? count - 1 - step : step
        const item = candidate.locator.nth(index)
        if (!await item.isVisible().catch(() => false)) continue
        const info = await descriptor(item)
        if (!await item.isEnabled().catch(() => true)) {
          this.remember(`${action}:${candidate.strategy}[${index}]:disabled:${info}`)
          continue
        }

        let clicked = await item.click({ timeout: Math.min(this.browser.navigationTimeoutMs, 5_000) })
          .then(() => true)
          .catch(() => false)
        this.remember(`${action}:${candidate.strategy}[${index}]:${clicked ? 'clicked' : 'click-failed'}:${info}`)

        if (!clicked) {
          clicked = await this.domClick(item)
          this.remember(`${action}:${candidate.strategy}[${index}]:${clicked ? 'dom-clicked' : 'dom-click-failed'}:${info}`)
        }
        if (!clicked) continue

        await this.settle()
        if (!verify || await verify()) return true

        this.remember(`${action}:${candidate.strategy}[${index}]:no-postcondition`)
        await this.page.keyboard.press('Escape').catch(() => undefined)
        await this.page.waitForTimeout(200).catch(() => undefined)
      }
    }
    return false
  }

  private async verifyChooser(pageUid: string): Promise<boolean> {
    const deadline = Date.now() + SURFACE_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (await countAcross(this.seeAllCandidates()) > 0) return true
      if (await countAcross(this.uidCandidates(pageUid, 'account_menu')) > 0) return true
      if (await countAcross(this.nameCandidates('account_menu')) > 0) return true
      if (await visibleCount(this.overlays().getByText(PROFILE_CHOOSER_PATTERN)) > 0) return true
      await this.page.waitForTimeout(POLL_MS)
    }
    return false
  }

  private async verifyAllProfiles(pageUid: string): Promise<boolean> {
    const deadline = Date.now() + SURFACE_TIMEOUT_MS
    const modal = this.page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible')
    const uid = escapeCss(pageUid.trim())
    const name = this.targetName?.trim()
    const exactName = name ? new RegExp(`^${escapeRegex(name)}$`, 'i') : null

    while (Date.now() < deadline) {
      if (uid && await visibleCount(modal.locator(`a[href*="${uid}"], [data-profileid="${uid}"], [data-profile-id="${uid}"], [data-pageid="${uid}"], [data-page-id="${uid}"]`)) > 0) {
        return true
      }
      if (exactName && await visibleCount(modal.getByText(exactName)) > 0) return true
      if (await visibleCount(modal.getByText(PROFILE_CHOOSER_PATTERN)) > 0) return true
      await this.page.waitForTimeout(POLL_MS)
    }
    return false
  }

  private async tryDirect(pageUid: string): Promise<PostingJobResult | null> {
    this.directAttempted = true
    for (const candidate of this.directCandidates()) {
      const count = await candidate.locator.count().catch(() => 0)
      for (let index = 0; index < count; index += 1) {
        const item = candidate.locator.nth(index)
        if (!await item.isVisible().catch(() => false)) continue
        const clicked = await this.clickCandidates('direct', [{ ...candidate, locator: item }])
        if (!clicked) continue

        const waited = await this.waitIdentity(pageUid, Math.min(this.browser.navigationTimeoutMs, 10_000))
        const waitFailure = this.waitFailure(waited, ' sau khi bấm switch trực tiếp')
        if (waitFailure) return waitFailure
        if (waited === 'matched') {
          return { status: 'success', message: 'Đã chuyển sang Page identity bằng direct switch và xác minh i_user.' }
        }
        this.remember(`direct:${candidate.strategy}[${index}]:i_user-timeout`)
      }
    }
    return null
  }

  private async selectTarget(pageUid: string, stage: PageIdentityStage): Promise<PostingJobResult | null> {
    const candidates = [...this.uidCandidates(pageUid, stage), ...this.nameCandidates(stage)]
    for (const candidate of candidates) {
      const count = await candidate.locator.count().catch(() => 0)
      for (let index = 0; index < count; index += 1) {
        const item = candidate.locator.nth(index)
        if (!await item.isVisible().catch(() => false)) continue
        const clicked = await this.clickCandidates('select-target', [{ ...candidate, locator: item }])
        if (!clicked) continue

        const waited = await this.waitIdentity(pageUid, Math.min(this.browser.navigationTimeoutMs, 12_000))
        const waitFailure = this.waitFailure(waited, ' sau khi chọn Page trong profile chooser')
        if (waitFailure) return waitFailure
        if (waited === 'matched') {
          return { status: 'success', message: 'Đã chọn Page trong profile chooser và xác minh i_user đúng Page UID.' }
        }
        this.remember(`select-target:${candidate.strategy}[${index}]:i_user-timeout`)
      }
    }
    return null
  }

  private async runChooser(pageUid: string): Promise<PostingJobResult | null> {
    this.currentStage = 'account_menu'

    const directTarget = await this.selectTarget(pageUid, 'account_menu')
    if (directTarget) return directTarget

    const seeAllVisible = await countAcross(this.seeAllCandidates()) > 0
    if (!seeAllVisible) return null

    const openedAll = await this.clickCandidates(
      'see-all',
      this.seeAllCandidates(),
      () => this.verifyAllProfiles(pageUid)
    )
    if (!openedAll) return null

    this.currentStage = 'all_profiles'
    return this.selectTarget(pageUid, 'all_profiles')
  }

  private async openChooser(pageUid: string): Promise<boolean> {
    return this.clickCandidates(
      'open-account-menu',
      this.accountCandidates(),
      () => this.verifyChooser(pageUid)
    )
  }

  private async openHome(reason: string): Promise<PostingJobResult | null> {
    this.homeFallbackAttempted = true
    this.remember(`home-fallback:${reason}`)
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
    const evidence: PageIdentityDiagnostics = {
      stage: this.currentStage,
      uidState: classifyPageIdentityUid(pageUid, active),
      directSwitchCount: await countAcross(this.directCandidates()),
      accountMenuCount: await countAcross(this.accountCandidates()),
      seeAllProfilesCount: await countAcross(this.seeAllCandidates()),
      targetUidCount: await countAcross(this.uidCandidates(pageUid, this.currentStage)),
      targetNameCount: await countAcross(this.nameCandidates(this.currentStage)),
      directAttempted: this.directAttempted,
      homeFallbackAttempted: this.homeFallbackAttempted,
      targetNameAvailable: Boolean(this.targetName),
      candidateAttempts: [...this.attempts],
      url: this.page.url()
    }
    return formatPageIdentityDiagnostics(evidence)
  }

  async switchTo(pageUid: string): Promise<PostingJobResult> {
    const uid = pageUid.trim()
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

    const active = await activeFacebookProfileId(this.context).catch(() => null)
    if (classifyPageIdentityUid(uid, active) === 'match') {
      return { status: 'success', message: 'Page identity đã active và khớp i_user.' }
    }

    this.targetName = await this.readTargetName()

    const direct = await this.tryDirect(uid)
    if (direct) return direct

    this.currentStage = 'page_surface'
    if (await this.openChooser(uid)) {
      const chooserResult = await this.runChooser(uid)
      if (chooserResult) return chooserResult
    }

    const homeFailure = await this.openHome('page-surface-chooser-not-confirmed')
    if (homeFailure) return homeFailure
    this.currentStage = 'page_surface'

    if (await this.openChooser(uid)) {
      const chooserResult = await this.runChooser(uid)
      if (chooserResult) return chooserResult
    }

    return failure(
      'page_identity_unconfirmed',
      `Không chuyển được Page sau direct path và một lần Home fallback. ${await this.diagnostics(uid)}`
    )
  }
}
