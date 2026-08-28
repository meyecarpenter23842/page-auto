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
  shuffled,
  sleepWithControl,
  splitLines,
  type BaseViewActionDependencies
} from './actionSupport'

// Reel selectors stay local to this action module.
export const REEL_SELECTORS = {
  likeButton: ['[role="button"][aria-label="Like"]', '[role="button"][aria-label="Thích"]'],
  commentButton: ['[role="button"][aria-label*="Comment" i]', '[role="button"][aria-label*="Bình luận" i]'],
  commentBox: ['[contenteditable="true"][aria-label*="comment" i]', '[contenteditable="true"][aria-label*="bình luận" i]', '[contenteditable="true"][data-lexical-editor="true"]'],
  commentImage: ['input[type="file"][accept*="image"]'],
  shareButton: ['[role="button"][aria-label*="Share" i]', '[role="button"][aria-label*="Chia sẻ" i]'],
  shareNow: ['[role="menuitem"]:has-text("Share now")', '[role="menuitem"]:has-text("Chia sẻ ngay")', '[role="button"]:has-text("Share now")', '[role="button"]:has-text("Chia sẻ ngay")'],
  shareGroup: ['[role="menuitem"]:has-text("Share to a group")', '[role="menuitem"]:has-text("Chia sẻ lên nhóm")', '[role="button"]:has-text("Share to a group")', '[role="button"]:has-text("Chia sẻ lên nhóm")'],
  dialogSearch: ['input[placeholder*="Search" i]', 'input[placeholder*="Tìm kiếm" i]'],
  dialogMessage: ['[contenteditable="true"][aria-label*="Say something" i]', '[contenteditable="true"][aria-label*="Nói gì đó" i]'],
  dialogPost: ['[role="button"]:has-text("Post")', '[role="button"]:has-text("Đăng")']
} as const

const REACTION_SELECTORS: Record<string, readonly string[]> = {
  like: REEL_SELECTORS.likeButton,
  love: ['[role="button"][aria-label="Love"]', '[role="button"][aria-label="Yêu thích"]'],
  care: ['[role="button"][aria-label="Care"]', '[role="button"][aria-label="Thương thương"]'],
  haha: ['[role="button"][aria-label="Haha"]'], wow: ['[role="button"][aria-label="Wow"]'],
  sad: ['[role="button"][aria-label="Sad"]', '[role="button"][aria-label="Buồn"]'],
  angry: ['[role="button"][aria-label="Angry"]', '[role="button"][aria-label="Phẫn nộ"]']
}

export interface ViewReelDependencies extends BaseViewActionDependencies {}

async function react(page: Page, reactions: readonly string[]): Promise<boolean> {
  const reaction = pickOne(reactions) ?? 'like'
  const likeButton = await firstVisible(page, REEL_SELECTORS.likeButton)
  if (!likeButton) return false
  if (reaction === 'like') return likeButton.click({ timeout: 5000 }).then(() => true).catch(() => false)
  if (!await likeButton.hover({ timeout: 5000 }).then(() => true).catch(() => false)) return false
  const choice = await firstVisible(page, REACTION_SELECTORS[reaction] ?? REEL_SELECTORS.likeButton)
  return choice ? choice.click({ timeout: 5000 }).then(() => true).catch(() => false) : false
}

async function comment(page: Page, text: string, imagePath: string): Promise<boolean> {
  await clickFirstVisible(page, REEL_SELECTORS.commentButton)
  const box: Locator | null = await firstVisible(page, REEL_SELECTORS.commentBox)
  if (!box) return false
  if (imagePath.trim()) {
    const input = page.locator(REEL_SELECTORS.commentImage[0]).first()
    if (await input.isVisible().catch(() => false)) await input.setInputFiles(imagePath.trim()).catch(() => undefined)
  }
  if (!await box.fill(text, { timeout: 5000 }).then(() => true).catch(() => false)) return false
  return box.press('Enter', { timeout: 5000 }).then(() => true).catch(() => false)
}

async function shareToWall(page: Page): Promise<boolean> {
  if (!await clickFirstVisible(page, REEL_SELECTORS.shareButton)) return false
  await page.waitForTimeout(250).catch(() => undefined)
  return clickFirstVisible(page, REEL_SELECTORS.shareNow)
}

async function shareToGroup(page: Page, groupUid: string, message: string): Promise<boolean> {
  if (!await clickFirstVisible(page, REEL_SELECTORS.shareButton)) return false
  await page.waitForTimeout(250).catch(() => undefined)
  if (!await clickFirstVisible(page, REEL_SELECTORS.shareGroup)) return false
  const search = await firstVisible(page, REEL_SELECTORS.dialogSearch)
  if (!search || !await search.fill(groupUid, { timeout: 5000 }).then(() => true).catch(() => false)) return false
  await page.waitForTimeout(500).catch(() => undefined)
  const candidate = page.getByText(groupUid, { exact: false }).first()
  if (!await candidate.isVisible().catch(() => false) || !await candidate.click({ timeout: 5000 }).then(() => true).catch(() => false)) return false
  if (message.trim()) {
    const messageBox = await firstVisible(page, REEL_SELECTORS.dialogMessage)
    if (messageBox) await messageBox.fill(message.trim(), { timeout: 5000 }).catch(() => undefined)
  }
  return clickFirstVisible(page, REEL_SELECTORS.dialogPost)
}

export class ViewReelActionExecutor implements ActionExecutor {
  readonly actionType = 'view_reel'
  constructor(private readonly dependencies: ViewReelDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('View reel')
    try {
      await page.goto('https://www.facebook.com/reel/', { waitUntil: 'domcontentloaded', timeout: this.dependencies.navigationTimeoutMs ?? 45_000 })
    } catch (error) {
      return navigationFailed('View reel', error)
    }

    const durationMinutes = pickRange(configNumber(config, 'durationMinMinutes', 5), configNumber(config, 'durationMaxMinutes', 5))
    const deadline = Date.now() + durationMinutes * 60_000
    const likeTarget = configBoolean(config, 'likeEnabled') ? pickRange(configNumber(config, 'likeMin'), configNumber(config, 'likeMax')) : 0
    const commentTarget = configBoolean(config, 'commentEnabled') ? pickRange(configNumber(config, 'commentMin'), configNumber(config, 'commentMax')) : 0
    const comments = splitLines(configString(config, 'commentTemplates'))
    const reactions = selectedReactions(config)
    const groups = shuffled(splitLines(configString(config, 'groupWhitelist')))
    const groupTarget = configBoolean(config, 'shareToGroup') ? Math.min(groups.length, pickRange(configNumber(config, 'shareGroupMin', 1), configNumber(config, 'shareGroupMax', 1))) : 0
    let viewed = 0, liked = 0, commented = 0, groupShared = 0
    let wallShared = false

    while (Date.now() < deadline && !context.control.isStopped()) {
      await context.control.waitIfPaused()
      viewed += 1
      if (liked < likeTarget && await react(page, reactions)) liked += 1
      if (commented < commentTarget) {
        const text = pickOne(comments)
        if (text && await comment(page, text, configString(config, 'commentImagePath'))) commented += 1
      }
      if (configBoolean(config, 'shareToWall') && !wallShared) wallShared = await shareToWall(page)
      while (groupShared < groupTarget) {
        const uid = groups[groupShared]
        if (!uid) break
        const ok = await shareToGroup(page, uid, configString(config, 'shareMessage'))
        if (!ok) context.log('warning', 'Không chia sẻ được reel tới Group UID; bỏ qua.', 'reel_group_share_failed', { groupUid: uid })
        groupShared += 1
      }
      if (!await sleepWithControl(context.control, 1800)) break
      await page.keyboard.press('ArrowDown').catch(() => undefined)
      await page.mouse.wheel(0, 850).catch(() => undefined)
    }

    if (context.control.isStopped()) return { status: 'stopped', code: 'action_stopped', message: 'View reel đã dừng.', data: { viewed, liked, commented, wallShared, groupShared } }
    return { status: 'success', code: 'view_reel_completed', message: 'View reel hoàn tất.', data: { viewed, liked, commented, wallShared, groupShared } }
  }
}
