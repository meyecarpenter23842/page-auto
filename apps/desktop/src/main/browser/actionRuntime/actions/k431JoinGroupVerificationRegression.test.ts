import { describe, expect, it, vi } from 'vitest'
import type { BrowserContext, Locator, Page } from 'playwright-core'
import type { ActionConfig } from '../../../../shared/actionRegistry'
import { ACTION_VERIFICATION_UNCERTAIN_CODE } from '../../../../shared/actionRuntime'
import type { ActionExecutorContext } from '../../../services/actionRunner'
import { JoinGroupActionExecutor } from './joinGroupAction'

const visualGuard = vi.hoisted(() => ({ failed: false }))

vi.mock('../../managedBrowserBridge', () => ({
  ensureManagedBrowserVisualLayout: async () => visualGuard.failed
    ? {
        status: 'failed',
        message: 'Visual/Layout Guard vẫn còn drift sau recovery: layout_viewport, device_pixel_ratio, visual_viewport.',
        drift: ['layout_viewport', 'device_pixel_ratio', 'visual_viewport'],
        snapshot: null
      }
    : {
        status: 'recovered',
        message: 'visual layout recovered',
        drift: ['outer_size'],
        snapshot: null
      }
}))

function emptyLocator(): Locator {
  const locator = {
    count: async () => 0,
    isVisible: async () => false,
    innerText: async () => '',
    getAttribute: async () => null,
    click: async () => undefined,
    fill: async () => undefined,
    first() { return this },
    nth() { return this },
    locator() { return this }
  }
  return locator as unknown as Locator
}

function config(overrides: Partial<ActionConfig> = {}): ActionConfig {
  return {
    sourceMode: 'id_list',
    sourceTargets: '123456',
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
    errorPauseMinutes: 0,
    pauseAfterCount: 0,
    pauseMinutes: 0,
    itemDelayMinSeconds: 0,
    itemDelayMaxSeconds: 0,
    ...overrides
  }
}

function actionContext(logs: string[] = []): ActionExecutorContext {
  return {
    request: {} as ActionExecutorContext['request'],
    attempt: 1,
    control: {
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      sleep: async () => undefined
    },
    log: (_level, message) => { logs.push(message) }
  }
}

function directGroupPage(input: {
  events: string[]
  membershipAfterReload: 'joined' | 'requested' | null
  membershipReadsBeforeHydration?: number
}): Page {
  const empty = emptyLocator()
  let reloaded = false
  let currentGroup = ''
  let membershipReads = 0

  const membershipLocator = (state: 'joined' | 'requested'): Locator => ({
    count: async () => {
      if (!reloaded || input.membershipAfterReload !== state) return 0
      membershipReads += 1
      return membershipReads > (input.membershipReadsBeforeHydration ?? 0) ? 1 : 0
    },
    isVisible: async () => true,
    innerText: async () => state === 'joined' ? 'Joined' : 'Pending',
    getAttribute: async () => null,
    first() { return this },
    nth() { return this },
    locator() { return empty }
  } as unknown as Locator)

  const joinButton = {
    count: async () => 1,
    isVisible: async () => true,
    innerText: async () => 'Join group',
    getAttribute: async () => null,
    click: async () => { input.events.push('join-click') },
    // This regression models a click whose immediate responsive state is intentionally unknown.
    // It does not model a real browser DOM fallback; the dedicated click-effect regression does.
    evaluate: async () => false,
    first() { return this },
    nth() { return this },
    locator() { return empty }
  } as unknown as Locator

  const joined = membershipLocator('joined')
  const requested = membershipLocator('requested')

  return {
    context: () => ({} as BrowserContext),
    goto: async (url: string) => {
      currentGroup = url.match(/\/groups\/([^/]+)/)?.[1] ?? ''
      reloaded = false
      membershipReads = 0
      input.events.push(`goto:${currentGroup}`)
      return null
    },
    reload: async () => {
      reloaded = true
      membershipReads = 0
      input.events.push('reload')
      return null
    },
    url: () => `https://www.facebook.com/groups/${currentGroup || '123456'}/`,
    locator: (selector: string) => {
      if (selector === 'body') {
        return { innerText: async () => 'Public group · 25K members' } as unknown as Locator
      }
      if (selector === '[role="dialog"]') return empty
      if (selector.includes('Joined') || selector.includes('Đã tham gia')) return joined
      if (
        selector.includes('Pending')
        || selector.includes('Đang chờ')
        || selector.includes('Hủy yêu cầu')
        || selector.includes('Cancel request')
      ) return requested
      if (selector.includes('Join group') || selector.includes('Tham gia nhóm')) return joinButton
      return empty
    },
    mouse: { wheel: async () => undefined }
  } as unknown as Page
}

describe('K4.3.1 robust post-action verification', () => {
  it('revisits the exact Group and treats Joined as success when immediate responsive verification misses', async () => {
    visualGuard.failed = false
    const events: string[] = []
    const logs: string[] = []
    const page = directGroupPage({ events, membershipAfterReload: 'joined' })
    const executor = new JoinGroupActionExecutor({ resolvePage: async () => page, navigationTimeoutMs: 45_000 })

    const result = await executor.execute(actionContext(logs), config())

    expect(events).toEqual(['goto:123456', 'join-click', 'reload'])
    expect(events.filter((event) => event === 'join-click')).toHaveLength(1)
    expect(result).toMatchObject({ status: 'success', code: 'join_group_completed' })
    expect(result.data).toMatchObject({ attempted: 1, joined: 1, requested: 0, uncertain: 0 })
    expect(logs).toContain('Đã xác minh lại đúng Group đích: Facebook đang hiển thị trạng thái Joined/Đã tham gia.')
  })

  it('revisits the exact Group and treats Pending as a verified submitted request', async () => {
    visualGuard.failed = false
    const events: string[] = []
    const page = directGroupPage({ events, membershipAfterReload: 'requested' })
    const executor = new JoinGroupActionExecutor({ resolvePage: async () => page, navigationTimeoutMs: 45_000 })

    const result = await executor.execute(actionContext(), config())

    expect(events).toEqual(['goto:123456', 'join-click', 'reload'])
    expect(result).toMatchObject({ status: 'success', code: 'join_group_completed' })
    expect(result.data).toMatchObject({ attempted: 1, joined: 0, requested: 1, uncertain: 0 })
  })

  it('keeps verifying the exact Group when visual recovery fails and Joined hydrates late', async () => {
    visualGuard.failed = true
    const events: string[] = []
    const logs: string[] = []
    const page = directGroupPage({
      events,
      membershipAfterReload: 'joined',
      membershipReadsBeforeHydration: 6
    })
    const executor = new JoinGroupActionExecutor({ resolvePage: async () => page, navigationTimeoutMs: 45_000 })

    const result = await executor.execute(actionContext(logs), config())

    expect(events).toEqual(['goto:123456', 'join-click', 'reload'])
    expect(events.filter((event) => event === 'join-click')).toHaveLength(1)
    expect(result).toMatchObject({ status: 'success', code: 'join_group_completed' })
    expect(result.data).toMatchObject({ attempted: 1, joined: 1, requested: 0, uncertain: 0 })
    expect(logs).toContain('Visual/Layout Guard vẫn còn drift sau recovery: layout_viewport, device_pixel_ratio, visual_viewport.')
    expect(logs).toContain('Đã xác minh lại đúng Group đích: Facebook đang hiển thị trạng thái Joined/Đã tham gia.')
    visualGuard.failed = false
  })

  it('returns typed uncertainty and stops before another Group instead of repeating a consequential click', async () => {
    visualGuard.failed = false
    const events: string[] = []
    const page = directGroupPage({ events, membershipAfterReload: null })
    const executor = new JoinGroupActionExecutor({ resolvePage: async () => page, navigationTimeoutMs: 45_000 })

    const result = await executor.execute(actionContext(), config({
      sourceTargets: '123456\n222222',
      joinMin: 2,
      joinMax: 2
    }))

    expect(events).toEqual(['goto:123456', 'join-click', 'reload'])
    expect(events.filter((event) => event === 'join-click')).toHaveLength(1)
    expect(events.some((event) => event === 'goto:222222')).toBe(false)
    expect(result).toMatchObject({ status: 'failed', code: ACTION_VERIFICATION_UNCERTAIN_CODE })
    expect(result.data).toMatchObject({ attempted: 1, joined: 0, requested: 0, uncertain: 1, target: 2 })
  })
})
