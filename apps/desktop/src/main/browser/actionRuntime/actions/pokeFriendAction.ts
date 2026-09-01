import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import { browserUnavailable, configBoolean, configNumber, navigationFailed, pickRange } from './actionSupport'
import { clickButtons, type FriendActionDependencies } from './friendActionSupport'

export const POKE_FRIEND_SELECTORS = {
  poke: ['div[role="button"]:text-is("Poke")', 'div[role="button"]:text-is("Chọc")'],
  pokeBack: ['div[role="button"]:text-is("Poke back")', 'div[role="button"]:text-is("Chọc lại")']
} as const

export function pokeFriendResult(
  poked: number,
  pokedBack: number,
  pokeTarget: number,
  backTarget: number,
  stopped = false
): ActionResult {
  const data = { poked, pokedBack }
  if (stopped) {
    return { status: 'stopped', code: 'action_stopped', message: 'Chọc bạn bè đã dừng.', data }
  }
  const requested = pokeTarget + backTarget
  const completed = poked + pokedBack
  if (requested <= 0) {
    return { status: 'skipped', code: 'poke_friend_no_requested_action', message: 'Không có thao tác chọc nào được cấu hình.', data }
  }
  if (completed <= 0) {
    return { status: 'skipped', code: 'poke_friend_no_verified_action', message: 'Không tìm thấy nút Chọc/Chọc lại phù hợp để thực hiện.', data }
  }
  if (completed < requested) {
    return {
      status: 'failed',
      code: 'poke_friend_incomplete',
      message: `Chọc bạn bè chưa đủ mục tiêu: ${completed}/${requested} thao tác.`,
      data
    }
  }
  return { status: 'success', code: 'poke_friend_completed', message: 'Chọc bạn bè hoàn tất.', data }
}

export class PokeFriendActionExecutor implements ActionExecutor {
  readonly actionType = 'poke_friend'
  constructor(private readonly dependencies: FriendActionDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('Chọc bạn bè')
    try {
      await page.goto('https://www.facebook.com/pokes', { waitUntil: 'domcontentloaded', timeout: this.dependencies.navigationTimeoutMs ?? 45_000 })
    } catch (error) {
      return navigationFailed('Chọc bạn bè', error)
    }
    const backTarget = configBoolean(config, 'pokeBackEnabled') ? pickRange(configNumber(config, 'pokeBackMin'), configNumber(config, 'pokeBackMax')) : 0
    const pokeTarget = configBoolean(config, 'pokeEnabled') ? pickRange(configNumber(config, 'pokeMin'), configNumber(config, 'pokeMax')) : 0
    const pokedBack = await clickButtons(page, POKE_FRIEND_SELECTORS.pokeBack, backTarget, context, config)
    const poked = await clickButtons(page, POKE_FRIEND_SELECTORS.poke, pokeTarget, context, config)
    return pokeFriendResult(poked, pokedBack, pokeTarget, backTarget, context.control.isStopped())
  }
}
