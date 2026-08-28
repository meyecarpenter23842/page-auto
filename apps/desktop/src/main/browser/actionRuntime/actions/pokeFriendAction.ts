import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import { browserUnavailable, configBoolean, configNumber, navigationFailed, pickRange } from './actionSupport'
import { clickButtons, type FriendActionDependencies } from './friendActionSupport'

export const POKE_FRIEND_SELECTORS = {
  poke: ['div[role="button"]:text-is("Poke")', 'div[role="button"]:text-is("Chọc")'],
  pokeBack: ['div[role="button"]:text-is("Poke back")', 'div[role="button"]:text-is("Chọc lại")']
} as const

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
    if (context.control.isStopped()) return { status: 'stopped', code: 'action_stopped', message: 'Chọc bạn bè đã dừng.', data: { poked, pokedBack } }
    return { status: 'success', code: 'poke_friend_completed', message: 'Chọc bạn bè hoàn tất.', data: { poked, pokedBack } }
  }
}
