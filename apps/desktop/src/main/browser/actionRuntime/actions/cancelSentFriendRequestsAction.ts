import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import { browserUnavailable, configNumber, navigationFailed, pickRange } from './actionSupport'
import { clickButtons, type FriendActionDependencies } from './friendActionSupport'

export const CANCEL_SENT_FRIEND_REQUEST_SELECTORS = [
  '[role="button"]:has-text("Cancel request")',
  '[role="button"]:has-text("Hủy yêu cầu")',
  '[role="button"]:has-text("Cancel")'
] as const

export class CancelSentFriendRequestsActionExecutor implements ActionExecutor {
  readonly actionType = 'cancel_sent_friend_requests'
  constructor(private readonly dependencies: FriendActionDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('Hủy yêu cầu bạn bè đã gửi')
    try {
      await page.goto('https://www.facebook.com/friends/requests/?outgoing=1', { waitUntil: 'domcontentloaded', timeout: this.dependencies.navigationTimeoutMs ?? 45_000 })
    } catch (error) {
      return navigationFailed('Hủy yêu cầu bạn bè đã gửi', error)
    }
    const target = pickRange(configNumber(config, 'cancelMin', 1), configNumber(config, 'cancelMax', 1))
    const cancelled = await clickButtons(page, CANCEL_SENT_FRIEND_REQUEST_SELECTORS, target, context, config)
    if (context.control.isStopped()) return { status: 'stopped', code: 'action_stopped', message: 'Hủy yêu cầu đã gửi đã dừng.', data: { cancelled } }
    return { status: 'success', code: 'cancel_sent_friend_requests_completed', message: 'Hủy yêu cầu đã gửi hoàn tất.', data: { cancelled, target } }
  }
}
