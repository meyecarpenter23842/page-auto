import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import { browserUnavailable, configBoolean, configNumber, configString, navigationFailed, pickOne, pickRange, sleepWithControl, splitLines } from './actionSupport'
import { commentAtVisibleBox, paced, reactAtVisibleLike, type FriendActionDependencies } from './friendActionSupport'

export const FRIEND_INTERACTION_SELECTORS = {
  profileLinks: ['a[role="link"][href*="facebook.com/"]'],
  article: ['div[role="article"]']
} as const

export interface FriendInteractionCounts {
  liked: number
  commented: number
  avatarLiked: number
}

export interface FriendInteractionTargets {
  likes: number
  comments: number
  avatarLikes: number
}

export function friendInteractionResult(
  counts: FriendInteractionCounts,
  targets: FriendInteractionTargets,
  stopped = false
): ActionResult {
  const data = { ...counts }
  if (stopped) {
    return { status: 'stopped', code: 'action_stopped', message: 'Tương tác bạn bè đã dừng.', data }
  }
  const requested = targets.likes + targets.comments + targets.avatarLikes
  const completed = counts.liked + counts.commented + counts.avatarLiked
  if (requested <= 0) {
    return { status: 'skipped', code: 'friend_interaction_no_requested_action', message: 'Không có thao tác bạn bè nào được cấu hình.', data }
  }
  if (completed <= 0) {
    return { status: 'skipped', code: 'friend_interaction_no_verified_action', message: 'Không xác nhận được reaction/comment/avatar phù hợp để tương tác.', data }
  }
  if (completed < requested) {
    return {
      status: 'failed',
      code: 'friend_interaction_incomplete',
      message: `Tương tác bạn bè chưa đủ mục tiêu: ${completed}/${requested} thao tác.`,
      data
    }
  }
  return { status: 'success', code: 'friend_interaction_completed', message: 'Tương tác bạn bè hoàn tất.', data }
}

export class FriendInteractionActionExecutor implements ActionExecutor {
  readonly actionType = 'friend_interaction'
  constructor(private readonly dependencies: FriendActionDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('Tương tác bạn bè')
    try {
      await page.goto('https://www.facebook.com/?sk=friends', { waitUntil: 'domcontentloaded', timeout: this.dependencies.navigationTimeoutMs ?? 45_000 })
    } catch (error) {
      return navigationFailed('Tương tác bạn bè', error)
    }

    const likeTarget = configBoolean(config, 'onlineLikeEnabled') ? pickRange(configNumber(config, 'onlineLikeMin'), configNumber(config, 'onlineLikeMax')) : 0
    const commentTarget = configBoolean(config, 'commentEnabled') ? pickRange(configNumber(config, 'commentMin'), configNumber(config, 'commentMax')) : 0
    const comments = splitLines(configString(config, 'commentTemplates'))
    const commentImagePath = configString(config, 'commentImagePath')
    let liked = 0
    let commented = 0
    let passes = 0

    while ((liked < likeTarget || commented < commentTarget) && passes < Math.max(10, likeTarget + commentTarget) && !context.control.isStopped()) {
      await context.control.waitIfPaused()
      passes += 1
      if (liked < likeTarget && await reactAtVisibleLike(page, config)) {
        liked += 1
        if (!await paced(context, config, liked + commented)) break
      }
      if (commented < commentTarget) {
        let text = pickOne(comments)
        if (configBoolean(config, 'usePostTextAsComment')) {
          const postText = await page.locator(FRIEND_INTERACTION_SELECTORS.article[0]).first().innerText().catch(() => '')
          if (postText.trim()) text = postText.trim().slice(0, 800)
        }
        if (text && await commentAtVisibleBox(page, text, commentImagePath)) {
          commented += 1
          if (!await paced(context, config, liked + commented)) break
        }
      }
      await page.keyboard.press(configBoolean(config, 'randomFriends') ? 'PageDown' : 'End').catch(() => undefined)
      if (!await sleepWithControl(context.control, 1200)) break
    }

    const avatarTarget = configBoolean(config, 'avatarLikeEnabled') ? pickRange(configNumber(config, 'avatarLikeMin'), configNumber(config, 'avatarLikeMax')) : 0
    let avatarLiked = 0
    if (avatarTarget > 0) {
      await page.goto('https://www.facebook.com/friends/list', { waitUntil: 'domcontentloaded', timeout: this.dependencies.navigationTimeoutMs ?? 45_000 }).catch(() => undefined)
      const links = page.locator(FRIEND_INTERACTION_SELECTORS.profileLinks[0])
      const count = await links.count().catch(() => 0)
      for (let index = 0; index < count && avatarLiked < avatarTarget && !context.control.isStopped(); index += 1) {
        const href = await links.nth(index).getAttribute('href').catch(() => null)
        if (!href) continue
        await page.goto(href, { waitUntil: 'domcontentloaded', timeout: this.dependencies.navigationTimeoutMs ?? 45_000 }).catch(() => undefined)
        if (await reactAtVisibleLike(page, config)) {
          avatarLiked += 1
          if (!await paced(context, config, liked + commented + avatarLiked)) break
        }
      }
    }

    return friendInteractionResult(
      { liked, commented, avatarLiked },
      { likes: likeTarget, comments: commentTarget, avatarLikes: avatarTarget },
      context.control.isStopped()
    )
  }
}
