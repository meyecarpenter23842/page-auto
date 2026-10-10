import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import { browserUnavailable, configString, navigationFailed, pickOne, splitLines } from './actionSupport'
import {
  findCommentArticle,
  interactionTarget,
  navigateInteractionTarget,
  paceAtomicInteraction,
  replyToComment,
  type CommentInteractionActionDependencies
} from './commentInteractionActionSupport'

export class ReplyCommentActionExecutor implements ActionExecutor {
  readonly actionType = 'reply_comment'

  constructor(private readonly dependencies: CommentInteractionActionDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('Trả lời comment')

    const target = interactionTarget(config)
    const timeoutMs = this.dependencies.navigationTimeoutMs ?? 45_000
    if (!await navigateInteractionTarget(page, target, timeoutMs)) {
      return navigationFailed('Trả lời comment', new Error('Không mở được target.'))
    }

    const article = await findCommentArticle(page, configString(config, 'commentMatch'))
    if (!article) {
      return { status: 'skipped', code: 'comment_not_found', message: 'Không tìm thấy comment phù hợp để trả lời.' }
    }

    const reply = pickOne(splitLines(configString(config, 'replyTemplates')))
    if (!reply) {
      return { status: 'failed', code: 'reply_content_missing', message: 'Không có nội dung trả lời hợp lệ.' }
    }

    const replied = await replyToComment(page, article, reply, configString(config, 'replyImagePath'))
    if (!replied) {
      return { status: 'failed', code: 'comment_reply_failed', message: 'Đã tìm thấy comment nhưng không xác nhận được thao tác trả lời.' }
    }

    await paceAtomicInteraction(context, config)
    if (context.control.isStopped()) return { status: 'stopped', code: 'action_stopped', message: 'Trả lời comment đã dừng.' }
    return { status: 'success', code: 'comment_reply_completed', message: 'Đã trả lời comment.' }
  }
}
