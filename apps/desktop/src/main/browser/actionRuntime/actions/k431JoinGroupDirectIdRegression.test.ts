import { describe, expect, it } from 'vitest'
import type { Locator, Page } from 'playwright-core'
import type { ActionExecutorContext } from '../../../services/actionRunner'
import { JoinGroupActionExecutor } from './joinGroupAction'

function emptyLocator(): Locator {
  const locator = {
    count: async () => 0,
    isVisible: async () => false,
    innerText: async () => '',
    getAttribute: async () => null,
    click: async () => undefined,
    first() { return this },
    nth() { return this },
    locator() { return this }
  }
  return locator as unknown as Locator
}

describe('K4.3.1 direct Group ID regression', () => {
  it('does not re-apply member filters to the Join button after the direct Group page already passed', async () => {
    const events: string[] = []
    const logs: string[] = []
    const empty = emptyLocator()

    const joined = {
      count: async () => 1,
      isVisible: async () => true,
      first() { return this },
      nth() { return this },
      locator() { return this }
    } as unknown as Locator

    const joinButton = {
      count: async () => 1,
      isVisible: async () => true,
      innerText: async () => 'Join group',
      getAttribute: async () => null,
      click: async () => { events.push('join-click') },
      first() { return this },
      nth() { return this },
      locator() { return empty }
    } as unknown as Locator

    const page = {
      goto: async () => { events.push('goto') },
      url: () => 'https://www.facebook.com/groups/123456/',
      locator: (selector: string) => {
        if (selector === 'body') {
          return { innerText: async () => 'Public group · 25K members' } as unknown as Locator
        }
        if (selector === '[role="dialog"]') return empty
        if (selector.includes('Join group') || selector.includes('Tham gia nhóm')) return joinButton
        if (selector.includes('Joined') || selector.includes('Đã tham gia')) return joined
        return empty
      },
      mouse: { wheel: async () => undefined }
    } as unknown as Page

    const executor = new JoinGroupActionExecutor({
      resolvePage: async () => page,
      navigationTimeoutMs: 45_000
    })
    const context = {
      request: {} as ActionExecutorContext['request'],
      attempt: 1,
      control: {
        isStopped: () => false,
        waitIfPaused: async () => undefined,
        sleep: async () => undefined
      },
      log: (_level: string, message: string) => { logs.push(message) }
    } as unknown as ActionExecutorContext

    const result = await executor.execute(context, {
      sourceMode: 'id_list',
      sourceTargets: '123456',
      joinMin: 1,
      joinMax: 1,
      memberFilterEnabled: true,
      memberMin: 10_000,
      memberMax: 0,
      privacyOpen: true,
      privacyClosed: true,
      skipApprovalRequired: false,
      answerQuestions: '',
      locationEnabled: false,
      locationKeyword: '',
      localeEnabled: false,
      locale: '',
      errorPauseMinutes: 0,
      pauseAfterCount: 0,
      pauseMinutes: 0,
      itemDelayMinSeconds: 0,
      itemDelayMaxSeconds: 0
    })

    expect(events).toEqual(['goto', 'join-click'])
    expect(result.status).toBe('success')
    expect(result.code).toBe('join_group_completed')
    expect(result.data).toMatchObject({ attempted: 1, joined: 1, skipped: 0 })
    expect(logs).toContain('Group ID đạt bộ lọc; bắt đầu thao tác Tham gia.')
  })
})
