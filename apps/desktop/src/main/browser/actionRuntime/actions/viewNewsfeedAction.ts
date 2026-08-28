import type { Locator, Page } from 'playwright-core'
import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import {
  browserUnavailable,
  clickFirstVisible,
  configBoolean,
  configNumber,
  configString,
  firstVisible,
  navigationFailed,
  pickOne,
  pickRange,
  selectedReactions,
  sleepWithControl,
  splitLines,
  type BaseViewActionDependencies
} from './actionSupport'

export const NEWSFEED_SOURCE_URLS: Record<string, string> = {
  home: 'https://www.facebook.com/',
  feed: 'https://www.facebook.com/?sk=h_chr',
  friends: 'https://www.facebook.com/friends/',
  pages: 'https://www.facebook.com/pages/feed/',
  groups: 'https://www.facebook.com/groups/feed/',
  group_newsfeed: 'https://www.facebook.com/groups/feed/'
}

// Facebook selectors live only in this module so UI changes stay localized.
export const NEWSFEED_SELECTORS = {
  article: ['div[role="feed"] div[role="article"]', 'div[role="article"]'],
  likeButton: ['[role="button"][aria-label="Like"]', '[role="button"][aria-label="Thích"]', 'button[aria-label="Like"]', 'button[aria-label="Thích"]'],
  commentBox: ['[contenteditable="true"][aria-label*="comment" i]', '[contenteditable="true"][aria-label*="bình luận" i]', '[contenteditable="true"][data-lexical-editor="true"]'],
  commentImage: ['input[type="file"][accept*="image"]'],
  shareButton: ['[role="button"][aria-label*="Share" i]', '[role="button"][aria-label*="Chia sẻ" i]'],
  shareNow: ['[role="menuitem"]:has-text("Share now")', '[role="menuitem"]:has-text("Chia sẻ ngay")', '[role="button"]:has-text("Share now")', '[role="button"]:has-text("Chia sẻ ngay")']
} as const

const REACTION_SELECTORS: Record<string, readonly string[]> = {
  like: NEWSFEED_SELECTORS.likeButton,
  love: ['[role="button"][aria-label="Love"]', '[role="button"][aria-label="Yêu thích"]'],
  care: ['[role="button"][aria-label="Care"]', '[role="button"][aria-label="Thương thương"]'],
  haha: ['[role="button"][aria-label="Haha"]'],
  wow: ['[role="button"][aria-label="Wow"]'],
  sad: ['[role="button"][aria-label="Sad"]', '[role="button"][aria-label="Buồn"]'],
  angry: ['[role="button"][aria-label="Angry"]', '[role="button"][aria-label="Phẫn nộ"]']
}

export interface NewsfeedContentCheckInput {
  text: string
  prompt: string
  includeImage: boolean
  article: Locator
}

export interface ViewNewsfeedDependencies extends BaseViewActionDependencies {
  classifyContent?: (input: NewsfeedContentCheckInput) => Promise<boolean>
}

async function reactToArticle(page: Page, article: Locator, reactions: readonly string[]): Promise<boolean> {
  const reaction = pickOne(reactions) ?? 'like'
  const likeButton = await firstVisible(article, NEWSFEED_SELECTORS.likeButton)
  if (!likeButton) return false
  if (reaction === 'like') return likeButton.click({ timeout: 5000 }).then(() => true).catch(() => false)
  if (!await likeButton.hover({ timeout: 5000 }).then(() => true).catch(() => false)) return false
  const choice = await firstVisible(page, REACTION_SELECTORS[reaction] ?? NEWSFEED_SELECTORS.likeButton)
  return choice ? choice.click({ timeout: 5000 }).then(() => true).catch(() => false) : false
}

async function commentOnArticle(article: Locator, text: string, imagePath: string): Promise<boolean> {
  const box = await firstVisible(article, NEWSFEED_SELECTORS.commentBox)
  if (!box) return false
  if (imagePath.trim()) {
    const input = article.locator(NEWSFEED_SELECTORS.commentImage[0]).first()
    if (await input.isVisible().catch(() => false)) await input.setInputFiles(imagePath.trim()).catch(() => undefined)
  }
  if (!await box.fill(text, { timeout: 5000 }).then(() => true).catch(() => false)) return false
  return box.press('Enter', { timeout: 5000 }).then(() => true).catch(() => false)
}

async function shareArticle(page: Page, article: Locator): Promise<boolean> {
  if (!await clickFirstVisible(article, NEWSFEED_SELECTORS.shareButton)) return false
  await page.waitForTimeout(250).catch(() => undefined)
  return clickFirstVisible(page, NEWSFEED_SELECTORS.shareNow)
}

export class ViewNewsfeedActionExecutor implements ActionExecutor {
  readonly actionType = 'view_newsfeed'
  constructor(private readonly dependencies: ViewNewsfeedDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('View newsfeed')
    const source = configString(config, 'feedSource') || 'home'
    const url = NEWSFEED_SOURCE_URLS[source] ?? NEWSFEED_SOURCE_URLS.home!
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.dependencies.navigationTimeoutMs ?? 45_000 })
    } catch (error) {
      return navigationFailed('View newsfeed', error)
    }

    const keywords = splitLines(configString(config, 'keywords'))
    const aiEnabled = configBoolean(config, 'aiContentCheckEnabled')
    if (aiEnabled && !this.dependencies.classifyContent) {
      return { status: 'failed', code: 'action_dependency_unavailable', message: 'View newsfeed: đã bật kiểm tra AI nhưng runtime chưa cung cấp content classifier.' }
    }

    const likeTarget = configBoolean(config, 'likeEnabled') ? pickRange(configNumber(config, 'likeMin'), configNumber(config, 'likeMax')) : 0
    const commentTarget = configBoolean(config, 'commentEnabled') ? pickRange(configNumber(config, 'commentMin'), configNumber(config, 'commentMax')) : 0
    const shareTarget = configBoolean(config, 'shareEnabled') ? pickRange(configNumber(config, 'shareMin'), configNumber(config, 'shareMax')) : 0
    const reactions = selectedReactions(config)
    const comments = splitLines(configString(config, 'commentTemplates'))
    const durationMinutes = pickRange(configNumber(config, 'durationMinMinutes', 5), configNumber(config, 'durationMaxMinutes', 5))
    const deadline = Date.now() + durationMinutes * 60_000
    const touched = new Set<string>()
    let viewed = 0, liked = 0, commented = 0, shared = 0

    while (Date.now() < deadline && !context.control.isStopped()) {
      await context.control.waitIfPaused()
      const articles = page.locator(NEWSFEED_SELECTORS.article[0])
      const count = Math.min(await articles.count().catch(() => 0), 30)
      for (let index = 0; index < count; index += 1) {
        if (context.control.isStopped() || Date.now() >= deadline) break
        const article = articles.nth(index)
        if (!await article.isVisible().catch(() => false)) continue
        const text = await article.innerText().catch(() => '')
        const key = text.slice(0, 180)
        if (key && touched.has(key)) continue
        if (key) touched.add(key)
        if (configBoolean(config, 'keywordFilterEnabled')) {
          const normalized = text.toLocaleLowerCase('vi')
          if (!keywords.some((keyword) => normalized.includes(keyword.toLocaleLowerCase('vi')))) continue
        }
        if (aiEnabled && this.dependencies.classifyContent) {
          const approved = await this.dependencies.classifyContent({ text, prompt: configString(config, 'aiPrompt'), includeImage: !configBoolean(config, 'skipImageCheck'), article }).catch(() => false)
          if (!approved) continue
        }
        viewed += 1
        if (liked < likeTarget && await reactToArticle(page, article, reactions)) liked += 1
        if (commented < commentTarget) {
          const comment = configBoolean(config, 'usePostTextAsComment') ? text.trim().slice(0, 5000) : (pickOne(comments) ?? '')
          if (comment && await commentOnArticle(article, comment, configString(config, 'commentImagePath'))) commented += 1
        }
        if (shared < shareTarget && await shareArticle(page, article)) shared += 1
      }
      await page.mouse.wheel(0, 900).catch(() => undefined)
      if (!await sleepWithControl(context.control, 1200)) break
    }

    if (context.control.isStopped()) return { status: 'stopped', code: 'action_stopped', message: 'View newsfeed đã dừng.', data: { viewed, liked, commented, shared } }
    return { status: 'success', code: 'view_newsfeed_completed', message: 'View newsfeed hoàn tất.', data: { viewed, liked, commented, shared, source } }
  }
}
