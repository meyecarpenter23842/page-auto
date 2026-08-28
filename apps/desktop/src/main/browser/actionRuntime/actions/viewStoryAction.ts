import type { Locator, Page } from 'playwright-core'
import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import {
  browserUnavailable,
  configBoolean,
  configNumber,
  configString,
  firstVisible,
  navigationFailed,
  pickOne,
  pickRange,
  selectedReactions,
  shuffled,
  sleepWithControl,
  splitLines,
  type BaseViewActionDependencies
} from './actionSupport'

// Story selectors stay local to this action module.
export const STORY_SELECTORS = {
  likeButton: ['[role="button"][aria-label="Like"]', '[role="button"][aria-label="Thích"]'],
  replyBox: ['input[placeholder*="Reply" i]', 'input[placeholder*="Trả lời" i]', '[contenteditable="true"][aria-label*="Reply" i]', '[contenteditable="true"][aria-label*="Trả lời" i]'],
  nextButton: ['[role="button"][aria-label="Next card"]', '[role="button"][aria-label="Thẻ tiếp theo"]', '[role="button"][aria-label="Next"]', '[role="button"][aria-label="Tiếp"]']
} as const

const REACTION_SELECTORS: Record<string, readonly string[]> = {
  like: STORY_SELECTORS.likeButton,
  love: ['[role="button"][aria-label="Love"]', '[role="button"][aria-label="Yêu thích"]'],
  care: ['[role="button"][aria-label="Care"]', '[role="button"][aria-label="Thương thương"]'],
  haha: ['[role="button"][aria-label="Haha"]'],
  wow: ['[role="button"][aria-label="Wow"]'],
  sad: ['[role="button"][aria-label="Sad"]', '[role="button"][aria-label="Buồn"]'],
  angry: ['[role="button"][aria-label="Angry"]', '[role="button"][aria-label="Phẫn nộ"]']
}

export interface ViewStoryDependencies extends BaseViewActionDependencies {}

async function react(page: Page, reactions: readonly string[]): Promise<boolean> {
  const reaction = pickOne(reactions) ?? 'like'
  const likeButton = await firstVisible(page, STORY_SELECTORS.likeButton)
  if (!likeButton) return false
  if (reaction === 'like') return likeButton.click({ timeout: 5000 }).then(() => true).catch(() => false)
  if (!await likeButton.hover({ timeout: 5000 }).then(() => true).catch(() => false)) return false
  const choice = await firstVisible(page, REACTION_SELECTORS[reaction] ?? STORY_SELECTORS.likeButton)
  return choice ? choice.click({ timeout: 5000 }).then(() => true).catch(() => false) : false
}

async function reply(page: Page, text: string): Promise<boolean> {
  const box: Locator | null = await firstVisible(page, STORY_SELECTORS.replyBox)
  if (!box) return false
  if (!await box.fill(text, { timeout: 5000 }).then(() => true).catch(() => false)) return false
  return box.press('Enter', { timeout: 5000 }).then(() => true).catch(() => false)
}

async function nextStory(page: Page): Promise<void> {
  const next = await firstVisible(page, STORY_SELECTORS.nextButton)
  if (next && await next.click({ timeout: 5000 }).then(() => true).catch(() => false)) return
  await page.keyboard.press('ArrowRight').catch(() => undefined)
}

export class ViewStoryActionExecutor implements ActionExecutor {
  readonly actionType = 'view_story'
  constructor(private readonly dependencies: ViewStoryDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('View story')

    const uidMode = configBoolean(config, 'randomUidEnabled')
    const allUids = splitLines(configString(config, 'storyUids'))
    const uidTarget = uidMode ? Math.min(allUids.length, pickRange(configNumber(config, 'randomUidMin', 1), configNumber(config, 'randomUidMax', 1))) : 0
    const selectedUids = uidMode ? shuffled(allUids).slice(0, uidTarget) : []
    const firstUrl = selectedUids[0] ? `https://www.facebook.com/stories/${encodeURIComponent(selectedUids[0])}/` : 'https://www.facebook.com/stories/'
    try {
      await page.goto(firstUrl, { waitUntil: 'domcontentloaded', timeout: this.dependencies.navigationTimeoutMs ?? 45_000 })
    } catch (error) {
      return navigationFailed('View story', error)
    }

    const durationMinutes = pickRange(configNumber(config, 'durationMinMinutes', 5), configNumber(config, 'durationMaxMinutes', 5))
    const deadline = Date.now() + durationMinutes * 60_000
    const likeTarget = configBoolean(config, 'likeEnabled') ? pickRange(configNumber(config, 'likeMin'), configNumber(config, 'likeMax')) : 0
    const commentTarget = configBoolean(config, 'commentEnabled') ? pickRange(configNumber(config, 'commentMin'), configNumber(config, 'commentMax')) : 0
    const reactions = selectedReactions(config)
    const comments = splitLines(configString(config, 'commentTemplates'))
    let viewed = 0, liked = 0, commented = 0, uidIndex = 0

    while (Date.now() < deadline && !context.control.isStopped()) {
      await context.control.waitIfPaused()
      viewed += 1
      if (liked < likeTarget && await react(page, reactions)) liked += 1
      if (commented < commentTarget) {
        const text = pickOne(comments)
        if (text && await reply(page, text)) commented += 1
      }
      if (!await sleepWithControl(context.control, 1800)) break
      if (selectedUids.length) {
        uidIndex = (uidIndex + 1) % selectedUids.length
        const uid = selectedUids[uidIndex]
        if (uid) await page.goto(`https://www.facebook.com/stories/${encodeURIComponent(uid)}/`, { waitUntil: 'domcontentloaded', timeout: this.dependencies.navigationTimeoutMs ?? 45_000 }).catch(() => undefined)
      } else {
        await nextStory(page)
      }
    }

    if (context.control.isStopped()) return { status: 'stopped', code: 'action_stopped', message: 'View story đã dừng.', data: { viewed, liked, commented } }
    return { status: 'success', code: 'view_story_completed', message: 'View story hoàn tất.', data: { viewed, liked, commented, uidMode } }
  }
}
