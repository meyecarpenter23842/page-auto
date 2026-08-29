import type { Locator, Page } from 'playwright-core'
import type { ActionConfig } from '../../../../shared/actionRegistry'
import type { ActionExecutorContext } from '../../../services/actionRunner'
import {
  configNumber,
  configString,
  firstVisible,
  pickOne,
  pickRange,
  selectedReactions,
  sleepWithControl,
  splitLines,
  type BaseViewActionDependencies
} from './actionSupport'
import { groupIdentityFromHref, normalizeGroupUrl } from './joinGroupActionSupport'

export interface GroupInteractionActionDependencies extends BaseViewActionDependencies {}

const ARTICLE_SELECTOR = 'div[role="article"]'
const GROUP_LINK_SELECTOR = 'a[href*="/groups/"]'
const LIKE_SELECTORS = ['[role="button"][aria-label="Like"]', '[role="button"][aria-label="Thích"]'] as const
const COMMENT_BOX_SELECTORS = [
  '[contenteditable="true"][aria-label*="comment" i]',
  '[contenteditable="true"][aria-label*="bình luận" i]'
] as const
const SHARE_SELECTORS = [
  '[role="button"][aria-label="Share"]',
  '[role="button"][aria-label="Chia sẻ"]',
  'div[role="button"]:has-text("Share")',
  'div[role="button"]:has-text("Chia sẻ")'
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

const RESTRICTION_PATTERNS: readonly { code: GroupRestrictionCode; pattern: RegExp }[] = [
  { code: 'comment_blocked', pattern: /(?:you (?:can(?:not|'t)|are unable to) comment|comments? (?:are|have been) turned off|bạn không thể bình luận|đã tắt bình luận|bị chặn bình luận)/i },
  { code: 'posting_blocked', pattern: /(?:you (?:can(?:not|'t)|are unable to) post|posting (?:is|has been) suspended|bạn không thể đăng|bị chặn đăng bài|tạm ngưng đăng bài)/i },
  { code: 'temporarily_restricted', pattern: /(?:temporarily (?:blocked|restricted)|tạm thời (?:bị )?(?:chặn|hạn chế)|tài khoản của bạn hiện bị hạn chế)/i }
]

export type GroupRestrictionCode = 'comment_blocked' | 'posting_blocked' | 'temporarily_restricted'

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

export function groupIdentityAllowed(identity: string | null, whitelist: readonly string[]): boolean {
  if (!whitelist.length) return true
  return identity !== null && whitelist.includes(identity.toLocaleLowerCase())
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

export async function reactToGroupArticle(page: Page, article: Locator, config: ActionConfig): Promise<boolean> {
  const like = await firstVisible(article, LIKE_SELECTORS)
  if (!like) return false
  const reaction = pickOne(selectedReactions(config)) ?? 'like'
  if (reaction === 'like') return like.click({ timeout: 5000 }).then(() => true).catch(() => false)
  if (!await like.hover({ timeout: 5000 }).then(() => true).catch(() => false)) return false
  const choice = await firstVisible(page, REACTION_SELECTORS[reaction] ?? LIKE_SELECTORS)
  return choice ? choice.click({ timeout: 5000 }).then(() => true).catch(() => false) : false
}

export async function commentOnGroupArticle(
  page: Page,
  article: Locator,
  text: string,
  imagePath: string
): Promise<boolean> {
  const box = await firstVisible(article, COMMENT_BOX_SELECTORS)
  if (!box) return false
  if (imagePath.trim()) {
    const articleInput = article.locator('input[type="file"][accept*="image" i]').first()
    const input = await articleInput.count().catch(() => 0) ? articleInput : page.locator('input[type="file"][accept*="image" i]').first()
    await input.setInputFiles(imagePath.trim()).catch(() => undefined)
  }
  if (!await box.fill(text, { timeout: 5000 }).then(() => true).catch(() => false)) return false
  return box.press('Enter', { timeout: 5000 }).then(() => true).catch(() => false)
}

export async function deleteGroupComment(page: Page, article: Locator, text: string): Promise<boolean> {
  const match = article.getByText(text, { exact: true }).last()
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
  return confirm ? confirm.click({ timeout: 5000 }).then(() => true).catch(() => false) : true
}

async function openShareMenu(article: Locator): Promise<boolean> {
  const share = await firstVisible(article, SHARE_SELECTORS)
  return Boolean(share && await share.click({ timeout: 5000 }).then(() => true).catch(() => false))
}

export async function shareGroupArticleToWall(page: Page, article: Locator): Promise<boolean> {
  if (!await openShareMenu(article)) return false
  const shareNow = await firstVisible(page, [
    '[role="menuitem"]:has-text("Share now")',
    '[role="menuitem"]:has-text("Chia sẻ ngay")',
    'div[role="button"]:has-text("Share now")',
    'div[role="button"]:has-text("Chia sẻ ngay")'
  ])
  if (shareNow) return shareNow.click({ timeout: 5000 }).then(() => true).catch(() => false)

  const shareFeed = await firstVisible(page, [
    '[role="menuitem"]:has-text("Share to Feed")',
    '[role="menuitem"]:has-text("Chia sẻ lên Bảng tin")',
    'div[role="button"]:has-text("Share to Feed")',
    'div[role="button"]:has-text("Chia sẻ lên Bảng tin")'
  ])
  if (!shareFeed || !await shareFeed.click({ timeout: 5000 }).then(() => true).catch(() => false)) return false
  const post = await firstVisible(page, [
    '[role="dialog"] [role="button"]:has-text("Post")',
    '[role="dialog"] [role="button"]:has-text("Đăng")'
  ])
  return post ? post.click({ timeout: 5000 }).then(() => true).catch(() => false) : false
}

export async function shareGroupArticleToGroup(page: Page, article: Locator, target: string): Promise<boolean> {
  if (!await openShareMenu(article)) return false
  const shareGroup = await firstVisible(page, [
    '[role="menuitem"]:has-text("Share to a group")',
    '[role="menuitem"]:has-text("Chia sẻ lên nhóm")',
    'div[role="button"]:has-text("Share to a group")',
    'div[role="button"]:has-text("Chia sẻ lên nhóm")'
  ])
  if (!shareGroup || !await shareGroup.click({ timeout: 5000 }).then(() => true).catch(() => false)) return false

  const dialog = page.locator('[role="dialog"]').last()
  const identity = normalizeConfiguredGroup(target)
  const groupLink = identity ? dialog.locator(`a[href*="/groups/${identity}"]`).first() : dialog.locator('a[href*="/groups/"]').first()
  if (await groupLink.isVisible().catch(() => false)) {
    await groupLink.click({ timeout: 5000 }).catch(() => undefined)
  } else {
    const search = await firstVisible(dialog, [
      'input[placeholder*="Search" i]',
      'input[placeholder*="Tìm kiếm" i]',
      '[role="textbox"][aria-label*="Search" i]',
      '[role="textbox"][aria-label*="Tìm kiếm" i]'
    ])
    if (!search || !await search.fill(target, { timeout: 5000 }).then(() => true).catch(() => false)) return false
    const candidate = identity ? dialog.locator(`a[href*="/groups/${identity}"]`).first() : dialog.locator('a[href*="/groups/"]').first()
    if (!await candidate.isVisible().catch(() => false)) return false
    await candidate.click({ timeout: 5000 }).catch(() => undefined)
  }

  const post = await firstVisible(page, [
    '[role="dialog"] [role="button"]:has-text("Post")',
    '[role="dialog"] [role="button"]:has-text("Đăng")'
  ])
  return post ? post.click({ timeout: 5000 }).then(() => true).catch(() => false) : false
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
