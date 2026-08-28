import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import { browserUnavailable, configBoolean, configNumber, navigationFailed, pickRange } from './actionSupport'
import { candidateMatches, clickButtons, type FriendActionDependencies } from './friendActionSupport'

export const ACCEPT_FRIEND_REQUEST_SELECTORS = {
  confirm: ['[role="button"]:has-text("Confirm")', '[role="button"]:has-text("Xác nhận")'],
  remove: ['[role="button"]:has-text("Delete")', '[role="button"]:has-text("Xóa")']
} as const

export class AcceptFriendRequestActionExecutor implements ActionExecutor {
  readonly actionType = 'accept_friend_request'
  constructor(private readonly dependencies: FriendActionDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('Chấp nhận kết bạn')
    try {
      await page.goto('https://www.facebook.com/friends/requests', { waitUntil: 'domcontentloaded', timeout: this.dependencies.navigationTimeoutMs ?? 45_000 })
    } catch (error) {
      return navigationFailed('Chấp nhận kết bạn', error)
    }
    const target = pickRange(configNumber(config, 'confirmMin', 1), configNumber(config, 'confirmMax', 1))
    let deleted = 0
    const accepted = await clickButtons(
      page,
      ACCEPT_FRIEND_REQUEST_SELECTORS.confirm,
      target,
      context,
      config,
      (button) => candidateMatches(button, config),
      async (button) => {
        if (!configBoolean(config, 'deleteUnmatched')) return
        const card = button.locator('xpath=ancestor::div[@role="article"][1]')
        for (const selector of ACCEPT_FRIEND_REQUEST_SELECTORS.remove) {
          const remove = card.locator(selector).first()
          if (await remove.isVisible().catch(() => false) && await remove.click({ timeout: 5000 }).then(() => true).catch(() => false)) {
            deleted += 1
            break
          }
        }
      }
    )
    if (context.control.isStopped()) return { status: 'stopped', code: 'action_stopped', message: 'Chấp nhận kết bạn đã dừng.', data: { accepted, deleted } }
    return { status: 'success', code: 'accept_friend_request_completed', message: 'Chấp nhận kết bạn hoàn tất.', data: { accepted, deleted, target } }
  }
}
