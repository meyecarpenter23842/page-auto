import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import { browserUnavailable, configNumber, configString, firstVisible, pickRange, splitLines } from './actionSupport'
import { paced, targetUrl, type FriendActionDependencies } from './friendActionSupport'

export const UNFRIEND_SELECTORS = {
  friendsButton: ['[role="button"]:has-text("Friends")', '[role="button"]:has-text("Bạn bè")'],
  unfriend: ['[role="menuitem"]:has-text("Unfriend")', '[role="menuitem"]:has-text("Hủy kết bạn")', '[role="button"]:has-text("Unfriend")', '[role="button"]:has-text("Hủy kết bạn")'],
  confirm: ['[role="dialog"] [role="button"]:has-text("Confirm")', '[role="dialog"] [role="button"]:has-text("Xác nhận")']
} as const

export class UnfriendActionExecutor implements ActionExecutor {
  readonly actionType = 'unfriend'
  constructor(private readonly dependencies: FriendActionDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('Hủy bạn bè')
    const target = pickRange(configNumber(config, 'unfriendMin', 1), configNumber(config, 'unfriendMax', 1))
    let removed = 0
    let unavailable = 0
    for (const uid of splitLines(configString(config, 'uids'))) {
      if (removed >= target || context.control.isStopped()) break
      if (!await page.goto(targetUrl(uid), { waitUntil: 'domcontentloaded', timeout: this.dependencies.navigationTimeoutMs ?? 45_000 }).then(() => true).catch(() => false)) {
        unavailable += 1
        continue
      }
      const friends = await firstVisible(page, UNFRIEND_SELECTORS.friendsButton)
      if (!friends || !await friends.click({ timeout: 5000 }).then(() => true).catch(() => false)) {
        unavailable += 1
        continue
      }
      const unfriend = await firstVisible(page, UNFRIEND_SELECTORS.unfriend)
      if (!unfriend || !await unfriend.click({ timeout: 5000 }).then(() => true).catch(() => false)) {
        unavailable += 1
        continue
      }
      const confirm = await firstVisible(page, UNFRIEND_SELECTORS.confirm)
      if (confirm) await confirm.click({ timeout: 5000 }).catch(() => undefined)
      removed += 1
      if (!await paced(context, config, removed)) break
    }
    if (context.control.isStopped()) return { status: 'stopped', code: 'action_stopped', message: 'Hủy bạn bè đã dừng.', data: { removed, unavailable } }
    return { status: 'success', code: 'unfriend_completed', message: 'Hủy bạn bè hoàn tất.', data: { removed, unavailable, target } }
  }
}
