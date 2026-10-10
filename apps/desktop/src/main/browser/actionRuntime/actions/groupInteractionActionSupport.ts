import type { Locator, Page } from 'playwright-core'
import type { ActionConfig } from '../../../../shared/actionRegistry'
import type { ActionExecutorContext } from '../../../services/actionRunner'
import { pollActionVerificationState } from '../actionVerification'
import {
  configNumber,
  configString,
  firstVisible,
  pickOne,
  pickRange,
  selectedReactions,
  sleepWithControl,
  splitLines,
  visibleSubmittedTextCount,
  waitForSubmittedTextIncrease,
  type BaseViewActionDependencies
} from './actionSupport'
import { groupIdentityFromHref, normalizeGroupUrl } from './joinGroupActionSupport'

export interface GroupInteractionActionDependencies extends BaseViewActionDependencies {}

const LIVE_REACTION_BUTTON_SELECTOR = '[role="button"]:has([data-ad-rendering-role="like_button"])'
const LIVE_MARKER_XPATH = '//*[@data-ad-rendering-role="like_button"]'
const LIVE_POST_BOUNDARY_XPATH = '//div[count(.//*[@data-ad-rendering-role="like_button"])=1 and count(parent::*//*[@data-ad-rendering-role="like_button"])>1]'
const LIVE_POST_EDITOR_CANDIDATE_XPATH = '//div[count(.//*[@data-ad-rendering-role="like_button"])=1 and .//*[@contenteditable="true"] and not(.//div[count(.//*[@data-ad-rendering-role="like_button"])=1 and .//*[@contenteditable="true"]])]'
const LIVE_POST_EDITOR_FALLBACK_XPATH = `${LIVE_POST_EDITOR_CANDIDATE_XPATH}[not(${LIVE_POST_BOUNDARY_XPATH})]`
const SINGLE_LIVE_REACTION_FALLBACK_XPATH = `//*[@role="button" and .//*[@data-ad-rendering-role="like_button"]][count(${LIVE_MARKER_XPATH})=1 and not(${LIVE_POST_BOUNDARY_XPATH}) and not(${LIVE_POST_EDITOR_CANDIDATE_XPATH})]`
const LEGACY_ARTICLE_FALLBACK_XPATH = '//div[@role="article" and not(//*[@data-ad-rendering-role="like_button"])]'
const ARTICLE_SELECTOR = `xpath=${LIVE_POST_BOUNDARY_XPATH} | ${LIVE_POST_EDITOR_FALLBACK_XPATH} | ${SINGLE_LIVE_REACTION_FALLBACK_XPATH} | ${LEGACY_ARTICLE_FALLBACK_XPATH}`
const GROUP_LINK_SELECTOR = 'a[href*="/groups/"]'
const LEGACY_LIKE_SELECTORS = [
  '[role="button"][aria-label="Like"]',
  '[role="button"][aria-label="Thích"]'
] as const
const LIKE_SELECTORS = [LIVE_REACTION_BUTTON_SELECTOR, ...LEGACY_LIKE_SELECTORS] as const
const COMMENT_BOX_SELECTORS = [
  '[contenteditable="true"][aria-label*="comment" i]',
  '[contenteditable="true"][aria-label*="bình luận" i]',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"]'
] as const
const SHARE_SELECTORS = [
  '[role="button"][aria-label="Share"]',
  '[role="button"][aria-label="Chia sẻ"]',
  'div[role="button"]:has-text("Share")',
  'div[role="button"]:has-text("Chia sẻ")'
] as const
const REACTION_CONFIG_KEYS = [
  'reactionLike',
  'reactionLove',
  'reactionCare',
  'reactionHaha',
  'reactionWow',
  'reactionSad',
  'reactionAngry'
] as const
const REACTION_SELECTORS: Record<string, readonly string[]> = {
  like: LIKE_SELECTORS,
  love: ['[role="button"][aria-label="Love"]', '[role="button"][aria-label="Yêu thích"]'],
  care: ['[role="button"][aria-label="Care"]', '[role="button"][aria-label="Thương thương"]'],
  haha: ['[role="button"][aria-label="Haha"]'],
  wow: ['[role="button"][aria-label="Wow"]'],
  sad: ['[role="button"][aria-label="Sad"]', '[role="button"][aria-label="Buồn"]'],
  angry: ['[role="button"][aria-label="Angry"]', '[role="button"][aria-label="Phẫn nộ"]']
}
const APPLIED_REACTION_LABEL_PATTERN = /^(?:Remove(?:\s|$)|Unlike(?:\s|$)|Bỏ(?:\s|$)|Gỡ(?:\s|$)|Xóa(?:\s|$))/i
const APPLIED_REACTION_SELECTORS = [
  '[role="button"][aria-label^="Remove "]',
  '[role="button"][aria-label^="Unlike"]',
  '[role="button"][aria-label^="Bỏ "]',
  '[role="button"][aria-label^="Gỡ "]',
  '[role="button"][aria-label^="Xóa "]'
] as const
const REACTION_VERIFY_TIMEOUT_MS = 3000
const REACTION_VERIFY_POLL_MS = 150
const COMMENT_VERIFY_TIMEOUT_MS = 3000
const COMMENT_VERIFY_POLL_MS = 150
const MAX_INTERACTION_SCOPE_ANCESTORS = 12
const INTERACTION_SCOPE_STOP_SELECTOR = 'xpath=self::main | self::body | self::*[@role="main" or @role="feed"]'
const SELF_LIVE_REACTION_CONTROL_SELECTOR = 'xpath=self::*[@role="button" and .//*[@data-ad-rendering-role="like_button"]]'

const RESTRICTION_PATTERNS: readonly { code: GroupRestrictionCode; pattern: RegExp }[] = [
  { code: 'comment_blocked', pattern: /(?:you (?:can(?:not|'t)|are unable to) comment|comments? (?:are|have been) turned off|bạn không thể bình luận|đã tắt bình luận|bị chặn bình luận)/i },
  { code: 'posting_blocked', pattern: /(?:you (?:can(?:not|'t)|are unable to) post|posting (?:is|has been) suspended|bạn không thể đăng|bị chặn đăng bài|tạm ngưng đăng bài)/i },
  { code: 'temporarily_restricted', pattern: /(?:temporarily (?:blocked|restricted)|tạm thời (?:bị )?(?:chặn|hạn chế)|tài khoản của bạn hiện bị hạn chế)/i }
]

export type GroupRestrictionCode = 'comment_blocked' | 'posting_blocked' | 'temporarily_restricted'

type ScopedVisibleLocator = {
  locator: Locator
  scope: Locator
}

function normalizeConfiguredGroup(value: string): string | null {
  const raw = value.trim()
  const href = /^(?:www\.)?facebook\.com\//i.test(raw) ? `https://${raw}` : raw
  const identity = groupIdentityFromHref(href)
  if (identity) return identity.toLocaleLowerCase()
  const trimmed = raw.replace(/^\/+|\/+$/g, '')
  if (!trimmed || /\s/.test(trimmed)) return null
  return trimmed.toLocaleLowerCase()
}

export function configuredGroupWhitelist(config: ActionConfig, key = 'groupWhitelist'): string[] {
  const output: string[] = []
  const seen = new Set<string>()
  for (const value of splitLines(configString(config, key))) {
    const identity = normalizeConfiguredGroup(value)
    if (!identity || seen.has(identity)) continue
    seen.add(identity)
    output.push(identity)
  }
  return output
}

export function directGroupUrlsFromWhitelist(whitelist: readonly string[], limit: number): string[] {
  return whitelist.slice(0, Math.max(0, limit)).map((identity) => normalizeGroupUrl(identity))
}

export function groupIdentityAllowed(identity: string | null, whitelist: readonly string[]): boolean {
  if (!whitelist.length) return true
  return identity !== null && whitelist.includes(identity.toLocaleLowerCase())
}

export function hasConfiguredGroupReaction(config: ActionConfig): boolean {
  return REACTION_CONFIG_KEYS.some((key) => config[key] === true)
}

export function isAppliedReactionAriaLabel(label: string | null | undefined): boolean {
  return Boolean(label && APPLIED_REACTION_LABEL_PATTERN.test(label.trim()))
}

export function classifyGroupRestriction(text: string): GroupRestrictionCode | null {
  for (const entry of RESTRICTION_PATTERNS) {
    if (entry.pattern.test(text)) return entry.code
  }
  return null
}

export async function articleGroupIdentity(article: Locator): Promise<string | null> {
  const links = article.locator(GROUP_LINK_SELECTOR)
  const count = await links.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const href = await links.nth(index).getAttribute('href').catch(() => null)
    const identity = href ? groupIdentityFromHref(href) : null
    if (identity) return identity.toLocaleLowerCase()
  }
  return null
}

export async function collectJoinedGroupUrls(page: Page, whitelist: readonly string[], limit: number): Promise<string[]> {
  const direct = directGroupUrlsFromWhitelist(whitelist, limit)
  if (direct.length) return direct

  const links = page.locator(GROUP_LINK_SELECTOR)
  const count = await links.count().catch(() => 0)
  const output: string[] = []
  const seen = new Set<string>()
  for (let index = 0; index < count && output.length < Math.max(0, limit); index += 1) {
    const href = await links.nth(index).getAttribute('href').catch(() => null)
    const identity = href ? groupIdentityFromHref(href) : null
    if (!identity) continue
    const normalized = identity.toLocaleLowerCase()
    if (seen.has(normalized) || !groupIdentityAllowed(normalized, whitelist)) continue
    seen.add(normalized)
    output.push(normalizeGroupUrl(identity))
  }
  return output
}

export async function sortGroupFeedByRecent(page: Page): Promise<boolean> {
  const sort = await firstVisible(page, [
    'div[role="button"]:has-text("Recent activity")',
    'div[role="button"]:has-text("Most recent")',
    'div[role="button"]:has-text("Hoạt động gần đây")',
    'div[role="button"]:has-text("Gần đây nhất")',
    'button:has-text("Recent activity")',
    'button:has-text("Hoạt động gần đây")'
  ])
  if (!sort) return false
  if (!await sort.click({ timeout: 5000 }).then(() => true).catch(() => false)) return false
  const newest = await firstVisible(page, [
    '[role="menuitem"]:has-text("New posts")',
    '[role="menuitem"]:has-text("Newest activity")',
    '[role="menuitem"]:has-text("Bài viết mới")',
    '[role="menuitem"]:has-text("Hoạt động mới nhất")',
    'div[role="menuitem"]:has-text("Most recent")',
    'div[role="menuitem"]:has-text("Gần đây nhất")'
  ])
  if (!newest) return true
  return newest.click({ timeout: 5000 }).then(() => true).catch(() => false)
}

async function livePrimaryReactionControl(scope: Locator): Promise<Locator | null> {
  const self = scope.locator(SELF_LIVE_REACTION_CONTROL_SELECTOR).first()
  if (await self.isVisible().catch(() => false)) return self
  return firstVisible(scope, [LIVE_REACTION_BUTTON_SELECTOR])
}

async function primaryReactionControl(scope: Locator): Promise<Locator | null> {
  return await livePrimaryReactionControl(scope) ?? firstVisible(scope, LEGACY_LIKE_SELECTORS)
}

async function firstVisibleWithScopeOrAncestors(
  scope: Locator,
  selectors: readonly string[]
): Promise<ScopedVisibleLocator | null> {
  const direct = await firstVisible(scope, selectors)
  if (direct) return { locator: direct, scope }

  for (let level = 1; level <= MAX_INTERACTION_SCOPE_ANCESTORS; level += 1) {
    const ancestor = scope.locator(`xpath=ancestor::*[${level}]`)
    if (!await ancestor.count().catch(() => 0)) break
    if (await ancestor.locator(INTERACTION_SCOPE_STOP_SELECTOR).count().catch(() => 0)) break

    const markerCount = await ancestor.locator('[data-ad-rendering-role="like_button"]').count().catch(() => 0)
    if (markerCount > 1) break

    const candidate = await firstVisible(ancestor, selectors)
    if (candidate) return { locator: candidate, scope: ancestor }
  }
  return null
}

async function firstVisibleInScopeOrAncestors(scope: Locator, selectors: readonly string[]): Promise<Locator | null> {
  return (await firstVisibleWithScopeOrAncestors(scope, selectors))?.locator ?? null
}

async function waitForAppliedReaction(page: Page, scope: Locator, timeoutMs = REACTION_VERIFY_TIMEOUT_MS): Promise<boolean> {
  const preferLiveControl = Boolean(await livePrimaryReactionControl(scope))
  const verified = await pollActionVerificationState(
    async () => {
      if (preferLiveControl) {
        const liveControl = await livePrimaryReactionControl(scope)
        const label = liveControl ? await liveControl.getAttribute('aria-label').catch(() => null) : null
        return isAppliedReactionAriaLabel(label) ? true : null
      }
      return await firstVisible(scope, APPLIED_REACTION_SELECTORS) ? true : null
    },
    {
      timeoutMs,
      intervalMs: REACTION_VERIFY_POLL_MS,
      wait: (delayMs) => page.waitForTimeout(delayMs).then(() => true).catch(() => false)
    }
  )
  return verified === true
}

async function clickReactionTargetAndVerify(page: Page, target: Locator, scope: Locator): Promise<boolean> {
  await target.scrollIntoViewIfNeeded().catch(() => undefined)

  try {
    await target.click({ timeout: 5000 })
    return waitForAppliedReaction(page, scope)
  } catch {
    if (await waitForAppliedReaction(page, scope, 750)) return true
  }

  try {
    await target.dispatchEvent('click')
  } catch {
    return false
  }
  return waitForAppliedReaction(page, scope)
}

async function openReactionPicker(control: Locator): Promise<boolean> {
  if (await control.hover({ timeout: 5000 }).then(() => true).catch(() => false)) return true
  return control.hover({ timeout: 5000, force: true }).then(() => true).catch(() => false)
}

export async function reactToGroupArticle(page: Page, article: Locator, config: ActionConfig): Promise<boolean> {
  if (!hasConfiguredGroupReaction(config)) return false
  const like = await primaryReactionControl(article)
  if (!like) return false
  if (await waitForAppliedReaction(page, article, 0)) return false

  const reaction = pickOne(selectedReactions(config))
  if (!reaction) return false
  if (reaction === 'like') return clickReactionTargetAndVerify(page, like, article)

  if (!await openReactionPicker(like)) return false
  let choice = await firstVisible(page, REACTION_SELECTORS[reaction] ?? LIKE_SELECTORS)
  if (!choice) {
    await like.hover({ timeout: 5000, force: true }).catch(() => undefined)
    choice = await firstVisible(page, REACTION_SELECTORS[reaction] ?? LIKE_SELECTORS)
  }
  return choice ? clickReactionTargetAndVerify(page, choice, article) : false
}

export async function commentOnGroupArticle(
  page: Page,
  article: Locator,
  text: string,
  imagePath: string
): Promise<boolean> {
  const value = text.trim()
  if (!value) return false
  const located = await firstVisibleWithScopeOrAncestors(article, COMMENT_BOX_SELECTORS)
  if (!located) return false
  const baseline = await visibleSubmittedTextCount(located.scope, value)
  if (imagePath.trim()) {
    const articleInput = article.locator('input[type="file"][accept*="image" i]').first()
    const input = await articleInput.count().catch(() => 0)
      ? articleInput
      : page.locator('input[type="file"][accept*="image" i]').first()
    if (!await input.count().catch(() => 0)) return false
    if (!await input.setInputFiles(imagePath.trim()).then(() => true).catch(() => false)) return false
  }
  if (!await located.locator.fill(value, { timeout: 5000 }).then(() => true).catch(() => false)) return false
  if (!await located.locator.press('Enter', { timeout: 5000 }).then(() => true).catch(() => false)) return false
  return waitForSubmittedTextIncrease(page, located.scope, value, baseline)
}

export async function deleteGroupComment(page: Page, article: Locator, text: string): Promise<boolean> {
  const value = text.trim()
  if (!value) return false
  const baseline = await visibleSubmittedTextCount(article, value)
  if (baseline <= 0) return false
  const match = article.getByText(value, { exact: true }).last()
  if (!await match.isVisible().catch(() => false)) return false
  const comment = match.locator('xpath=ancestor::div[@role="article"][1]')
  const scope = await comment.count().catch(() => 0) ? comment : match.locator('xpath=ancestor::div[1]')
  const menu = await firstVisible(scope, [
    '[role="button"][aria-label*="Actions for this comment" i]',
    '[role="button"][aria-label*="Hành động cho bình luận" i]',
    '[role="button"][aria-label="More"]',
    '[role="button"][aria-label="Thêm"]'
  ])
  if (!menu || !await menu.click({ timeout: 5000 }).then(() => true).catch(() => false)) return false
  const remove = await firstVisible(page, [
    '[role="menuitem"]:has-text("Delete")',
    '[role="menuitem"]:has-text("Xóa")',
    'div[role="menuitem"]:has-text("Delete")',
    'div[role="menuitem"]:has-text("Xóa")'
  ])
  if (!remove || !await remove.click({ timeout: 5000 }).then(() => true).catch(() => false)) return false
  const confirm = await firstVisible(page, [
    '[role="dialog"] [role="button"]:has-text("Delete")',
    '[role="dialog"] [role="button"]:has-text("Xóa")',
    '[role="dialog"] button:has-text("Delete")',
    '[role="dialog"] button:has-text("Xóa")'
  ])
  if (confirm && !await confirm.click({ timeout: 5000 }).then(() => true).catch(() => false)) return false

  const verified = await pollActionVerificationState(
    async () => await visibleSubmittedTextCount(article, value) < baseline ? true : null,
    {
      timeoutMs: COMMENT_VERIFY_TIMEOUT_MS,
      intervalMs: COMMENT_VERIFY_POLL_MS,
      wait: (delayMs) => page.waitForTimeout(delayMs).then(() => true).catch(() => false)
    }
  )
  return verified === true
}

async function openShareMenu(article: Locator): Promise<boolean> {
  const share = await firstVisibleInScopeOrAncestors(article, SHARE_SELECTORS)
  return Boolean(share && await share.click({ timeout: 5000 }).then(() => true).catch(() => false))
}

async function dismissShareSurface(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => undefined)
}

async function clickPostAndVerifyDialogClosed(page: Page, dialog: Locator, post: Locator): Promise<boolean> {
  if (!await post.click({ timeout: 5000 }).then(() => true).catch(() => false)) return false
  return dialog.waitFor({ state: 'hidden', timeout: 10_000 }).then(() => true).catch(() => false)
}

async function firstVisibleShareDestination(page: Page, labels: readonly string[]): Promise<Locator | null> {
  for (const label of labels) {
    const menuItem = page.getByRole('menuitem', { name: label, exact: true }).first()
    if (await menuItem.isVisible().catch(() => false)) return menuItem
    const button = page.getByRole('button', { name: label, exact: true }).first()
    if (await button.isVisible().catch(() => false)) return button
  }
  return null
}

export async function shareGroupArticleToWall(page: Page, article: Locator): Promise<boolean> {
  if (!await openShareMenu(article)) return false
  const shareNow = await firstVisibleShareDestination(page, ['Share now', 'Chia sẻ ngay'])
  if (shareNow) {
    if (!await shareNow.click({ timeout: 5000 }).then(() => true).catch(() => false)) {
      await dismissShareSurface(page)
      return false
    }
    const completed = await shareNow.waitFor({ state: 'hidden', timeout: 10_000 }).then(() => true).catch(() => false)
    if (!completed) await dismissShareSurface(page)
    return completed
  }

  const shareFeed = await firstVisibleShareDestination(page, ['Share to Feed', 'Chia sẻ lên Bảng tin'])
  if (!shareFeed || !await shareFeed.click({ timeout: 5000 }).then(() => true).catch(() => false)) {
    await dismissShareSurface(page)
    return false
  }

  const dialog = page.locator('[role="dialog"]').last()
  const post = await firstVisible(dialog, [
    '[role="button"]:has-text("Post")',
    '[role="button"]:has-text("Đăng")'
  ])
  if (!post) {
    await dismissShareSurface(page)
    return false
  }
  const completed = await clickPostAndVerifyDialogClosed(page, dialog, post)
  if (!completed) await dismissShareSurface(page)
  return completed
}

export async function shareGroupArticleToGroup(page: Page, article: Locator, target: string): Promise<boolean> {
  if (!await openShareMenu(article)) return false
  const shareGroup = await firstVisibleShareDestination(page, ['Share to a group', 'Chia sẻ lên nhóm'])
  if (!shareGroup || !await shareGroup.click({ timeout: 5000 }).then(() => true).catch(() => false)) {
    await dismissShareSurface(page)
    return false
  }

  const dialog = page.locator('[role="dialog"]').last()
  const identity = normalizeConfiguredGroup(target)
  const groupLink = identity ? dialog.locator(`a[href*="/groups/${identity}"]`).first() : dialog.locator('a[href*="/groups/"]').first()
  if (await groupLink.isVisible().catch(() => false)) {
    if (!await groupLink.click({ timeout: 5000 }).then(() => true).catch(() => false)) {
      await dismissShareSurface(page)
      return false
    }
  } else {
    const search = await firstVisible(dialog, [
      'input[placeholder*="Search" i]',
      'input[placeholder*="Tìm kiếm" i]',
      '[role="textbox"][aria-label*="Search" i]',
      '[role="textbox"][aria-label*="Tìm kiếm" i]'
    ])
    if (!search || !await search.fill(target, { timeout: 5000 }).then(() => true).catch(() => false)) {
      await dismissShareSurface(page)
      return false
    }
    const candidate = identity ? dialog.locator(`a[href*="/groups/${identity}"]`).first() : dialog.locator('a[href*="/groups/"]').first()
    if (!await candidate.isVisible().catch(() => false)
      || !await candidate.click({ timeout: 5000 }).then(() => true).catch(() => false)) {
      await dismissShareSurface(page)
      return false
    }
  }

  const post = await firstVisible(dialog, [
    '[role="button"]:has-text("Post")',
    '[role="button"]:has-text("Đăng")'
  ])
  if (!post) {
    await dismissShareSurface(page)
    return false
  }
  const completed = await clickPostAndVerifyDialogClosed(page, dialog, post)
  if (!completed) await dismissShareSurface(page)
  return completed
}

export async function leaveCurrentGroup(page: Page): Promise<boolean> {
  const joined = await firstVisible(page, [
    '[role="button"][aria-label="Joined"]',
    '[role="button"][aria-label="Đã tham gia"]',
    'div[role="button"]:has-text("Joined")',
    'div[role="button"]:has-text("Đã tham gia")'
  ])
  if (!joined || !await joined.click({ timeout: 5000 }).then(() => true).catch(() => false)) return false
  const leave = await firstVisible(page, [
    '[role="menuitem"]:has-text("Leave group")',
    '[role="menuitem"]:has-text("Rời nhóm")',
    'div[role="button"]:has-text("Leave group")',
    'div[role="button"]:has-text("Rời nhóm")'
  ])
  if (!leave || !await leave.click({ timeout: 5000 }).then(() => true).catch(() => false)) return false
  const confirm = await firstVisible(page, [
    '[role="dialog"] [role="button"]:has-text("Leave group")',
    '[role="dialog"] [role="button"]:has-text("Rời nhóm")'
  ])
  return confirm ? confirm.click({ timeout: 5000 }).then(() => true).catch(() => false) : true
}

export async function paceGroupInteraction(context: ActionExecutorContext, config: ActionConfig, completed: number): Promise<boolean> {
  const pauseAfter = configNumber(config, 'pauseAfterCount', 0)
  if (pauseAfter > 0 && completed > 0 && completed % pauseAfter === 0) {
    const pauseMs = configNumber(config, 'pauseMinutes', 0) * 60_000
    if (pauseMs > 0 && !await sleepWithControl(context.control, pauseMs)) return false
  }
  const delaySeconds = pickRange(
    configNumber(config, 'itemDelayMinSeconds', 0),
    configNumber(config, 'itemDelayMaxSeconds', 0)
  )
  return sleepWithControl(context.control, delaySeconds * 1000)
}

export async function viewGroupArticle(context: ActionExecutorContext, config: ActionConfig): Promise<boolean> {
  const seconds = pickRange(configNumber(config, 'viewMinSeconds', 0), configNumber(config, 'viewMaxSeconds', 0))
  return sleepWithControl(context.control, seconds * 1000)
}

export function groupArticles(page: Page): Locator {
  return page.locator(ARTICLE_SELECTOR)
}
