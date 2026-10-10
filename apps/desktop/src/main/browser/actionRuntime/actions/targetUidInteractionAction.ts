import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import {
  browserUnavailable,
  configBoolean,
  configNumber,
  configString,
  pickOne,
  shuffled,
  splitLines
} from './actionSupport'
import { commentAtVisibleBox, reactAtVisibleLike, targetUrl, type FriendActionDependencies } from './friendActionSupport'
import { paceAtomicInteraction } from './commentInteractionActionSupport'

type TargetUidStats = {
  targetsVisited: number
  postsAttempted: number
  reacted: number
  commented: number
  failedTargets: number
}

export class TargetUidInteractionActionExecutor implements ActionExecutor {
  readonly actionType = 'target_uid_interaction'

  constructor(private readonly dependencies: FriendActionDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('Tương tác theo UID')

    const rawTargets = splitLines(configString(config, 'targets'))
    const limit = Math.max(1, configNumber(config, 'targetsPerRun', rawTargets.length || 1))
    const targets = (configBoolean(config, 'randomTargets') ? shuffled(rawTargets) : rawTargets).slice(0, limit)
    const postsPerTarget = Math.max(1, configNumber(config, 'postsPerTarget', 1))
    const comments = splitLines(configString(config, 'commentTemplates'))
    const stats: TargetUidStats = { targetsVisited: 0, postsAttempted: 0, reacted: 0, commented: 0, failedTargets: 0 }
    const timeoutMs = this.dependencies.navigationTimeoutMs ?? 45_000

    for (const target of targets) {
      if (context.control.isStopped()) break
      await context.control.waitIfPaused()
      if (context.control.isStopped()) break

      const navigated = await page.goto(targetUrl(target), { waitUntil: 'domcontentloaded', timeout: timeoutMs })
        .then(() => true)
        .catch(() => false)
      if (!navigated) {
        stats.failedTargets += 1
        continue
      }
      stats.targetsVisited += 1

      for (let index = 0; index < postsPerTarget && !context.control.isStopped(); index += 1) {
        await context.control.waitIfPaused()
        if (context.control.isStopped()) break
        stats.postsAttempted += 1

        let completed = false
        if (configBoolean(config, 'reactionEnabled') && await reactAtVisibleLike(page, config)) {
          stats.reacted += 1
          completed = true
        }
        if (configBoolean(config, 'commentEnabled')) {
          const text = pickOne(comments)
          if (text && await commentAtVisibleBox(page, text, configString(config, 'commentImagePath'))) {
            stats.commented += 1
            completed = true
          }
        }

        if (completed && !await paceAtomicInteraction(context, config)) break
        if (index + 1 < postsPerTarget) {
          await page.keyboard.press('PageDown').catch(() => undefined)
          await context.control.sleep(700)
        }
      }
    }

    if (context.control.isStopped()) {
      return { status: 'stopped', code: 'action_stopped', message: 'Tương tác theo UID đã dừng.', data: stats }
    }
    if (stats.reacted > 0 || stats.commented > 0) {
      return {
        status: 'success',
        code: 'target_uid_interaction_completed',
        message: `Tương tác theo UID hoàn tất: ${stats.reacted} reaction, ${stats.commented} comment.`,
        data: stats
      }
    }
    if (stats.targetsVisited > 0) {
      return {
        status: 'skipped',
        code: 'target_uid_no_eligible_post',
        message: 'Đã mở target nhưng không xác nhận được bài viết phù hợp để tương tác.',
        data: stats
      }
    }
    return {
      status: 'failed',
      code: 'target_uid_navigation_failed',
      message: 'Không mở được target UID/URL nào trong danh sách.',
      data: stats
    }
  }
}
