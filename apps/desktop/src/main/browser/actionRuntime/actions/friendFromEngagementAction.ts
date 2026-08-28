import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import { browserUnavailable, configBoolean, configNumber, configString, firstVisible, pickRange, splitLines } from './actionSupport'
import { ADD_FRIEND_SELECTORS, clickButtons, collectProfileHrefs, groupMembersUrl, paced, targetUrl, type FriendActionDependencies } from './friendActionSupport'

export const FRIEND_FROM_ENGAGEMENT_SELECTORS = {
  reactionSummary: ['[role="button"][aria-label*="reaction" i]', '[role="button"][aria-label*="cảm xúc" i]', 'span[role="button"]:has-text("reactions")'],
  commentProfiles: ['div[role="article"] ul a[role="link"][href*="facebook.com/"]'],
  postAuthors: ['div[role="article"] h2 a[role="link"][href*="facebook.com/"]', 'div[role="article"] h3 a[role="link"][href*="facebook.com/"]']
} as const

export class FriendFromEngagementActionExecutor implements ActionExecutor {
  readonly actionType = 'friend_from_engagement'
  constructor(private readonly dependencies: FriendActionDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('Kết bạn người like comment')
    const mode = configString(config, 'sourceMode') || 'engagement'
    const sources = splitLines(configString(config, 'sourceTargets')).slice(0, configNumber(config, 'sourcesPerAccount', 10))
    const target = pickRange(configNumber(config, 'requestMin', 1), configNumber(config, 'requestMax', 1))
    const profileBudget = Math.max(target * 4, configNumber(config, 'postsToScan', 20))
    let sent = 0
    let visited = 0

    for (const source of sources) {
      if (sent >= target || context.control.isStopped()) break
      visited += 1
      const url = mode === 'group_members' ? groupMembersUrl(source) : targetUrl(source)
      if (!await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.dependencies.navigationTimeoutMs ?? 45_000 }).then(() => true).catch(() => false)) continue

      if (mode === 'group_members') {
        sent += await clickButtons(page, ADD_FRIEND_SELECTORS, target - sent, context, config)
      } else {
        if (configBoolean(config, 'scanLikes') && sent < target) {
          const summary = await firstVisible(page, FRIEND_FROM_ENGAGEMENT_SELECTORS.reactionSummary)
          if (summary && await summary.click({ timeout: 5000 }).then(() => true).catch(() => false)) {
            sent += await clickButtons(page, ADD_FRIEND_SELECTORS, target - sent, context, config)
            await page.keyboard.press('Escape').catch(() => undefined)
          }
        }

        const profileLinks = [
          ...(configBoolean(config, 'scanComments') ? await collectProfileHrefs(page, FRIEND_FROM_ENGAGEMENT_SELECTORS.commentProfiles, profileBudget) : []),
          ...(configBoolean(config, 'scanPosts') ? await collectProfileHrefs(page, FRIEND_FROM_ENGAGEMENT_SELECTORS.postAuthors, profileBudget) : [])
        ]
        for (const href of [...new Set(profileLinks)]) {
          if (sent >= target || context.control.isStopped()) break
          if (!await page.goto(href, { waitUntil: 'domcontentloaded', timeout: this.dependencies.navigationTimeoutMs ?? 45_000 }).then(() => true).catch(() => false)) continue
          const button = await firstVisible(page, ADD_FRIEND_SELECTORS)
          if (!button || !await button.click({ timeout: 5000 }).then(() => true).catch(() => false)) continue
          sent += 1
          if (!await paced(context, config, sent)) break
        }
      }
      if (!await paced(context, config, Math.max(1, sent))) break
    }

    if (context.control.isStopped()) return { status: 'stopped', code: 'action_stopped', message: 'Kết bạn người like/comment đã dừng.', data: { sent, visited, mode } }
    return {
      status: 'success',
      code: 'friend_from_engagement_completed',
      message: 'Kết bạn người like/comment hoàn tất.',
      data: { sent, visited, mode, target, sourceConsumedInRun: configBoolean(config, 'removeSourceAfterRun') }
    }
  }
}
