import type { Locator, Page } from 'playwright-core'
import type { ActionConfig } from '../../../../shared/actionRegistry'
import type { ActionExecutorContext } from '../../../services/actionRunner'
import {
  configNumber,
  configString,
  firstVisible,
  pickOne,
  selectedReactions,
  sleepWithControl,
  type BaseViewActionDependencies
} from './actionSupport'
import { targetUrl } from './friendActionSupport'

export interface CommentInteractionActionDependencies extends BaseViewActionDependencies {}

const COMMENT_ARTICLE_SELECTORS = ['div[role="article"]'] as const
const COMMENT_LIKE_SELECTORS = [
  '[role="button"][aria-label="Like"]',
  '[role="button"][aria-label="Thích"]',
  'div[role="button"]:has-text("Like")',
  'div[role="button"]:has-text("Thích")'
] as const
const REPLY_SELECTORS = [
  'div[role="button"]:has-text("Reply")',
  'div[role="button"]:has-text("Trả lời")',
  'span[role="button"]:has-text("Reply")',
  'span[role="button"]:has-text("Trả lời")'
] as const
const COMMENT_BOX_SELECTORS = [
  '[contenteditable="true"][aria-label*="comment" i]',
  '[contenteditable="true"][aria-label*="bình luận" i]',
  '[contenteditable="true"][aria-label*="reply" i]',
  '[contenteditable="true"][aria-label*="trả lời" i]'
] as const
const MENTION_OPTION_SELECTORS = [
  '[role="listbox"] [role="option"]',
  '[role="menu"] [role="menuitem"]',
  '[role="dialog"] [role="option"]'
] as const
const REACTION_SELECTORS: Record<string, readonly string[]> = {
  like: COMMENT_LIKE_SELECTORS,
  love: ['[role="button"][aria-label="Love"]', '[role="button"][aria-label="Yêu thích"]'],
  care: ['[role="button"][aria-label="Care"]', '[role="button"][aria-label="Thương thương"]'],
  haha: ['[role="button"][aria-label="Haha"]'],
  wow: ['[role="button"][aria-label="Wow"]'],
  sad: ['[role="button"][aria-label="Sad"]', '[role="button"][aria-label="Buồn"]'],
  angry: ['[role="button"][aria-label="Angry"]', '[role="button"][aria-label="Phẫn nộ"]']
}

export async function navigateInteractionTarget(page: Page, value: string, timeoutMs = 45_000): Promise<boolean> {
  const input = value.trim()
  if (!input) return false
  return page.goto(targetUrl(input), { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false)
}

export async function findCommentArticle(page: Page, matchText = ''): Promise<Locator | null> {
  const wanted = matchText.trim().toLocaleLowerCase('vi')
  for (const selector of COMMENT_ARTICLE_SELECTORS) {
    const articles = page.locator(selector)
    const count = Math.min(await articles.count().catch(() => 0), 100)
    for (let index = 0; index < count; index += 1) {
      const article = articles.nth(index)
      if (!await article.isVisible().catch(() => false)) continue
      const text = await article.innerText().catch(() => '')
      if (wanted && !text.toLocaleLowerCase('vi').includes(wanted)) continue
      const hasLike = await article.locator(COMMENT_LIKE_SELECTORS.join(',')).count().catch(() => 0)
      const hasReply = await article.locator(REPLY_SELECTORS.join(',')).count().catch(() => 0)
      if (hasLike > 0 || hasReply > 0) return article
    }
  }
  return null
}

export async function reactToComment(page: Page, article: Locator, config: ActionConfig): Promise<boolean> {
  const like = await firstVisible(article, COMMENT_LIKE_SELECTORS)
  if (!like) return false
  const reaction = pickOne(selectedReactions(config)) ?? 'like'
  if (reaction === 'like') return like.click({ timeout: 5000 }).then(() => true).catch(() => false)
  if (!await like.hover({ timeout: 5000 }).then(() => true).catch(() => false)) return false
  const choice = await firstVisible(page, REACTION_SELECTORS[reaction] ?? COMMENT_LIKE_SELECTORS)
  return choice ? choice.click({ timeout: 5000 }).then(() => true).catch(() => false) : false
}

async function attachImageIfConfigured(page: Page, imagePath: string): Promise<void> {
  if (!imagePath.trim()) return
  const input = page.locator('input[type="file"][accept*="image" i]').first()
  await input.setInputFiles(imagePath.trim()).catch(() => undefined)
}

export async function replyToComment(page: Page, article: Locator, text: string, imagePath = ''): Promise<boolean> {
  const reply = await firstVisible(article, REPLY_SELECTORS)
  if (!reply || !await reply.click({ timeout: 5000 }).then(() => true).catch(() => false)) return false
  const box = await firstVisible(page, COMMENT_BOX_SELECTORS)
  if (!box) return false
  await attachImageIfConfigured(page, imagePath)
  if (!await box.fill(text, { timeout: 5000 }).then(() => true).catch(() => false)) return false
  return box.press('Enter', { timeout: 5000 }).then(() => true).catch(() => false)
}

export async function commentWithTag(page: Page, tagTarget: string, text: string): Promise<boolean> {
  const box = await firstVisible(page, COMMENT_BOX_SELECTORS)
  if (!box) return false
  if (!await box.click({ timeout: 5000 }).then(() => true).catch(() => false)) return false
  if (!await box.pressSequentially(`@${tagTarget.trim()}`, { delay: 25 }).then(() => true).catch(() => false)) return false
  const option = await firstVisible(page, MENTION_OPTION_SELECTORS)
  if (!option || !await option.click({ timeout: 5000 }).then(() => true).catch(() => false)) return false
  if (text.trim()) {
    await box.pressSequentially(` ${text.trim()}`, { delay: 10 }).catch(() => undefined)
  }
  return box.press('Enter', { timeout: 5000 }).then(() => true).catch(() => false)
}

export async function paceAtomicInteraction(context: ActionExecutorContext, config: ActionConfig): Promise<boolean> {
  const min = configNumber(config, 'itemDelayMinSeconds', 0)
  const max = configNumber(config, 'itemDelayMaxSeconds', 0)
  const low = Math.min(min, max)
  const high = Math.max(min, max)
  const seconds = high <= low ? low : Math.floor(low + Math.random() * (high - low + 1))
  return sleepWithControl(context.control, seconds * 1000)
}

export function interactionTarget(config: ActionConfig): string {
  return configString(config, 'targetUrl').trim()
}
