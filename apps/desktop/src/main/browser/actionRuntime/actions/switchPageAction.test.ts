import { describe, expect, it } from 'vitest'
import { getActionDefinition } from '../../../../shared/actionRegistry'
import { applyActionOverrides } from '../../../../shared/actionOverrides'
import type { ActionExecutorContext } from '../../../services/actionRunner'
import { SwitchPageActionExecutor } from './switchPageAction'

applyActionOverrides()

describe('SwitchPageActionExecutor', () => {
  it('keeps switch_page visible and ready as a Page-only common runtime module', () => {
    expect(getActionDefinition('switch_page')).toMatchObject({
      runtimeStatus: 'ready',
      capabilities: { actors: ['page'], requiresNavigation: false }
    })
  })

  it('returns success after ActionRunner/Common Runtime prepared the Page actor', async () => {
    const logs: string[] = []
    const context: ActionExecutorContext = {
      request: {
        runKey: 'switch-page-test',
        actionType: 'switch_page',
        label: 'Switch Page',
        actor: { kind: 'page', accountId: 1, accountUid: '10001', pageUid: '20002' },
        config: {}
      },
      attempt: 1,
      control: {
        isStopped: () => false,
        waitIfPaused: async () => undefined,
        sleep: async () => undefined
      },
      log: (_level, message) => logs.push(message)
    }

    const result = await new SwitchPageActionExecutor().execute(context, {})
    expect(result).toMatchObject({ status: 'success' })
    expect(result.message).toContain('20002')
    expect(logs[0]).toContain('Facebook Common Runtime')
  })
})
