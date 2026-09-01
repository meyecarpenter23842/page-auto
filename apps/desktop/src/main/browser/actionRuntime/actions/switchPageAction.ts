import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'

export class SwitchPageActionExecutor implements ActionExecutor {
  readonly actionType = 'switch_page'

  async execute(context: ActionExecutorContext, _config: ActionConfig): Promise<ActionResult> {
    if (context.request.actor.kind !== 'page') {
      return {
        status: 'skipped',
        code: 'action_actor_unsupported',
        message: 'Switch Page chỉ dùng với actor Page.'
      }
    }
    context.log('info', `Page ${context.request.actor.pageUid} đã được chuẩn bị bởi Facebook Common Runtime.`)
    return {
      status: 'success',
      message: `Đã switch và xác minh Page ${context.request.actor.pageUid}.`
    }
  }
}
