import type { Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import type { ActionExecutorContext } from '../../../services/actionRunner'
import { GroupInteractionActionExecutor } from './groupInteractionAction'

describe('K4.3.3 explicit Group source routing', () => {
  it('opens a configured Group UID directly without touching the joined-groups surface', async () => {
    const visited: string[] = []
    let currentUrl = 'https://www.facebook.com/'
    const page = {
      goto: async (url: string) => {
        visited.push(url)
        currentUrl = url
        return null
      },
      url: () => currentUrl,
      locator: (selector: string) => selector === 'body'
        ? { innerText: async () => '' }
        : { count: async () => 0 },
      mouse: { wheel: async () => undefined }
    } as unknown as Page

    const executor = new GroupInteractionActionExecutor({ resolvePage: async () => page })
    const context = {
      request: {} as never,
      attempt: 1,
      control: {
        isStopped: () => false,
        waitIfPaused: async () => undefined,
        sleep: async () => undefined
      },
      log: () => undefined
    } as ActionExecutorContext

    const result = await executor.execute(context, {
      sourceMode: 'joined_groups',
      joinedGroupMin: 1,
      joinedGroupMax: 1,
      groupWhitelist: '1527231867322980',
      reactionEnabled: true,
      reactionMin: 1,
      reactionMax: 1,
      reactionLike: true,
      commentEnabled: false,
      shareWallEnabled: false,
      shareGroupEnabled: false,
      viewEnabled: false,
      restrictedGroupPolicy: 'skip',
      itemDelayMinSeconds: 0,
      itemDelayMaxSeconds: 0,
      pauseAfterCount: 0,
      pauseMinutes: 0
    })

    expect(visited).toEqual(['https://www.facebook.com/groups/1527231867322980/'])
    expect(visited).not.toContain('https://www.facebook.com/groups/joins/')
    expect(result.status).toBe('skipped')
  })
})
