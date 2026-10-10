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
      count: async () => events.includes('join-click') ? 1 : 0,
      isVisible: async () => true,
      getAttribute: async () => null,
      first() { return this },
      nth() { return this },
      locator() { return empty }
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

  it('skips an already joined direct target and never clicks Join buttons from Related groups', async () => {
    const events: string[] = []
    const logs: string[] = []
    const sleeps: number[] = []
    const empty = emptyLocator()
    let currentGroup = ''
    let secondGroupJoined = false

    const relatedLink = {
      count: async () => 1,
      getAttribute: async () => '/groups/999999/',
      first() { return this },
      nth() { return this },
      locator() { return empty }
    } as unknown as Locator
    const relatedLinks = {
      count: async () => 1,
      nth: () => relatedLink,
      first() { return relatedLink },
      locator() { return empty }
    } as unknown as Locator
    const relatedContainer = {
      count: async () => 1,
      innerText: async () => 'Related group · Join group',
      first() { return this },
      nth() { return this },
      locator(selector: string) {
        return selector === 'a[href*="/groups/"]' ? relatedLinks : empty
      }
    } as unknown as Locator
    const relatedJoinButton = {
      count: async () => 1,
      isVisible: async () => true,
      innerText: async () => 'Join group',
      getAttribute: async () => null,
      click: async () => { events.push('related-click') },
      first() { return this },
      nth() { return this },
      locator(selector: string) {
        if (selector.includes('@role="article"')) return empty
        if (selector.includes('a[contains(@href,"/groups/")]')) return relatedContainer
        return empty
      }
    } as unknown as Locator
    const mainJoinButton = {
      count: async () => 1,
      isVisible: async () => true,
      innerText: async () => 'Join group',
      getAttribute: async () => null,
      click: async () => {
        events.push('target-click')
        secondGroupJoined = true
      },
      first() { return this },
      nth() { return this },
      locator() { return empty }
    } as unknown as Locator
    const targetJoined = {
      count: async () => currentGroup === '111111' || (currentGroup === '222222' && secondGroupJoined) ? 1 : 0,
      isVisible: async () => true,
      getAttribute: async () => null,
      first() { return this },
      nth() { return this },
      locator() { return empty }
    } as unknown as Locator

    const page = {
      goto: async (url: string) => {
        currentGroup = url.match(/\/groups\/([^/]+)/)?.[1] ?? ''
        events.push(`goto:${currentGroup}`)
      },
      url: () => `https://www.facebook.com/groups/${currentGroup}/`,
      locator: (selector: string) => {
        if (selector === 'body') {
          return { innerText: async () => 'Public group · 25K members' } as unknown as Locator
        }
        if (selector === '[role="dialog"]') return empty
        if (selector === 'a[href*="/groups/"]') return empty
        if (selector.includes('Joined') || selector.includes('Đã tham gia')) return targetJoined
        if (selector.includes('Pending') || selector.includes('Đang chờ') || selector.includes('Hủy yêu cầu') || selector.includes('Cancel request')) return empty
        if (selector.includes('Join group') || selector.includes('Tham gia nhóm')) {
          return currentGroup === '111111' ? relatedJoinButton : mainJoinButton
        }
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
        sleep: async (delayMs: number) => { sleeps.push(delayMs) }
      },
      log: (_level: string, message: string) => { logs.push(message) }
    } as unknown as ActionExecutorContext

    const result = await executor.execute(context, {
      sourceMode: 'id_list',
      sourceTargets: '111111\n222222',
      joinMin: 1,
      joinMax: 1,
      memberFilterEnabled: false,
      memberMin: 0,
      memberMax: 0,
      privacyOpen: true,
      privacyClosed: true,
      skipApprovalRequired: false,
      answerQuestions: '',
      locationEnabled: false,
      locationKeyword: '',
      localeEnabled: false,
      locale: '',
      errorPauseMinutes: 10,
      pauseAfterCount: 0,
      pauseMinutes: 0,
      itemDelayMinSeconds: 0,
      itemDelayMaxSeconds: 0
    })

    expect(events).toEqual(['goto:111111', 'goto:222222', 'target-click'])
    expect(events).not.toContain('related-click')
    expect(result.status).toBe('success')
    expect(result.code).toBe('join_group_completed')
    expect(result.data).toMatchObject({ attempted: 1, joined: 1, skipped: 1 })
    expect(logs).toContain('Bỏ qua Group ID hiện tại vì account đã là thành viên của Group đích.')
    expect(sleeps.reduce((total, value) => total + value, 0)).toBe(700)
  })
})
