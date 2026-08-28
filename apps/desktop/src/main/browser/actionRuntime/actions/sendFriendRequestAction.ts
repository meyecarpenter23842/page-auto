import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import { browserUnavailable, configNumber, configString, firstVisible, navigationFailed, pickRange, splitLines } from './actionSupport'
import { ADD_FRIEND_SELECTORS, candidateMatches, clickButtons, paced, targetUrl, type FriendActionDependencies } from './friendActionSupport'

export class SendFriendRequestActionExecutor implements ActionExecutor {
  readonly actionType = 'send_friend_request'
  constructor(private readonly dependencies: FriendActionDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('Kết bạn')
    const target = pickRange(configNumber(config, 'requestMin', 1), configNumber(config, 'requestMax', 1))
    const mode = configString(config, 'sourceMode') || 'suggestions'
    const source = configString(config, 'sourceValue')
    let sent = 0

    if (mode === 'uid_list') {
      for (const uid of splitLines(source)) {
        if (sent >= target || context.control.isStopped()) break
        if (!await page.goto(targetUrl(uid), { waitUntil: 'domcontentloaded', timeout: this.dependencies.navigationTimeoutMs ?? 45_000 }).then(() => true).catch(() => false)) continue
        const button = await firstVisible(page, ADD_FRIEND_SELECTORS)
        if (button && await button.click({ timeout: 5000 }).then(() => true).catch(() => false)) {
          sent += 1
          if (!await paced(context, config, sent)) break
        }
      }
    } else {
      let url = 'https://www.facebook.com/friends/suggestions'
      if (mode === 'keyword_search') url = /^https?:\/\//i.test(source.trim()) ? source.trim() : `https://www.facebook.com/search/people/?q=${encodeURIComponent(source.trim())}`
      if (mode === 'friend_of_friend') {
        const first = splitLines(source)[0]
        if (first) url = `${targetUrl(first).replace(/\/$/, '')}/friends`
      }
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.dependencies.navigationTimeoutMs ?? 45_000 })
      } catch (error) {
        return navigationFailed('Kết bạn', error)
      }
      sent = await clickButtons(page, ADD_FRIEND_SELECTORS, target, context, config, (button) => candidateMatches(button, config))
    }

    if (context.control.isStopped()) return { status: 'stopped', code: 'action_stopped', message: 'Kết bạn đã dừng.', data: { sent, mode } }
    return { status: 'success', code: 'send_friend_request_completed', message: 'Kết bạn hoàn tất.', data: { sent, mode, target } }
  }
}
