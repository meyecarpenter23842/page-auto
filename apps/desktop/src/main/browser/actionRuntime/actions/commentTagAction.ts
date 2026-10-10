import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import { browserUnavailable, configString, navigationFailed, pickOne, splitLines } from './actionSupport'
import {
  commentWithTag,
  interactionTarget,
  navigateInteractionTarget,
  paceAtomicInteraction,
  type CommentInteractionActionDependencies
} from './commentInteractionActionSupport'

export class CommentTagActionExecutor implements ActionExecutor {
  readonly actionType = 'comment_tag'

  constructor(private readonly dependencies: CommentInteractionActionDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('Comment tag')

    const target = interactionTarget(config)
    const timeoutMs = this.dependencies.navigationTimeoutMs ?? 45_000
    if (!await navigateInteractionTarget(page, target, timeoutMs)) {
      return navigationFailed('Comment tag', new Error('Không mở được target.'))
    }

    const tagTarget = pickOne(splitLines(configString(config, 'tagTargets')))
    if (!tagTarget) {
      return { status: 'failed', code: 'tag_target_missing', message: 'Không có target hợp lệ để tag.' }
    }
    const text = pickOne(splitLines(configString(config, 'commentTemplates'))) ?? ''
    const tagged = await commentWithTag(page, tagTarget, text)
    if (!tagged) {
      return { status: 'failed', code: 'comment_tag_failed', message: 'Không xác nhận được mention/tag từ suggestion của Facebook.' }
    }

    await paceAtomicInteraction(context, config)
    if (context.control.isStopped()) return { status: 'stopped', code: 'action_stopped', message: 'Comment tag đã dừng.' }
    return { status: 'success', code: 'comment_tag_completed', message: 'Đã đăng comment có tag.' }
  }
}
