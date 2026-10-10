import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import { browserUnavailable, configString, navigationFailed } from './actionSupport'
import {
  findCommentArticle,
  interactionTarget,
  navigateInteractionTarget,
  paceAtomicInteraction,
  reactToComment,
  type CommentInteractionActionDependencies
} from './commentInteractionActionSupport'

export class ReactCommentActionExecutor implements ActionExecutor {
  readonly actionType = 'react_comment'

  constructor(private readonly dependencies: CommentInteractionActionDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('Thả cảm xúc comment')

    const target = interactionTarget(config)
    const timeoutMs = this.dependencies.navigationTimeoutMs ?? 45_000
    if (!await navigateInteractionTarget(page, target, timeoutMs)) {
      return navigationFailed('Thả cảm xúc comment', new Error('Không mở được target.'))
    }

    const article = await findCommentArticle(page, configString(config, 'commentMatch'))
    if (!article) {
      return { status: 'skipped', code: 'comment_not_found', message: 'Không tìm thấy comment phù hợp để thả cảm xúc.' }
    }

    const reacted = await reactToComment(page, article, config)
    if (!reacted) {
      return { status: 'failed', code: 'comment_reaction_failed', message: 'Đã tìm thấy comment nhưng không xác nhận được thao tác cảm xúc.' }
    }

    await paceAtomicInteraction(context, config)
    if (context.control.isStopped()) return { status: 'stopped', code: 'action_stopped', message: 'Thả cảm xúc comment đã dừng.' }
    return { status: 'success', code: 'comment_reaction_completed', message: 'Đã thả cảm xúc comment.' }
  }
}
