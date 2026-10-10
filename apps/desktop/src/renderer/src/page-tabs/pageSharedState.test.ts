import { describe, expect, it } from 'vitest'
import type { PageTabConfig } from '../../../shared/pageTabs'
import { accountInputsForSelection, buildSharedPageSaveInput } from './pageSharedState'

function sampleConfig(): PageTabConfig {
  return {
    id: 7,
    name: 'Page A',
    pageUid: '111',
    status: 'idle',
    createdAt: 1,
    updatedAt: 2,
    rotation: {
      postsPerAccount: 3,
      postDelayMinSeconds: 10,
      postDelayMaxSeconds: 20,
      accountDelayMinSeconds: 30,
      accountDelayMaxSeconds: 40,
      accountOrderMode: 'random'
    },
    accounts: [
      { accountId: 10, enabled: false, sortOrder: 0, postsPerTurn: 4, uid: 'u10', name: 'A', status: 'valid', category: null },
      { accountId: 20, enabled: true, sortOrder: 1, postsPerTurn: null, uid: 'u20', name: 'B', status: 'valid', category: 'x' }
    ],
    schedules: [{ id: 1, dayOfWeek: 2, startMinute: 480, endMinute: 600, enabled: true, sortOrder: 0 }],
    groupUids: ['g1', 'g2'],
    groupOrderMode: 'random',
    contentMode: 'random',
    contents: ['post-a'],
    image: { folderPath: 'C:/images', mode: 'random', imagesPerPost: 2, missingPolicy: 'skip' }
  }
}

describe('shared Page state', () => {
  it('updates shared identity/accounts without destroying Group business config', () => {
    const config = sampleConfig()
    const selected = accountInputsForSelection(config, [20, 30])
    const save = buildSharedPageSaveInput(config, { name: 'Page mới', pageUid: '999', accounts: selected })

    expect(save.name).toBe('Page mới')
    expect(save.pageUid).toBe('999')
    expect(save.accounts).toEqual([
      { accountId: 20, enabled: true, sortOrder: 0, postsPerTurn: null },
      { accountId: 30, enabled: true, sortOrder: 1, postsPerTurn: null }
    ])
    expect(save.rotation).toEqual(config.rotation)
    expect(save.schedules).toEqual([{ dayOfWeek: 2, startMinute: 480, endMinute: 600, enabled: true, sortOrder: 0 }])
    expect(save.groupUids).toEqual(['g1', 'g2'])
    expect(save.groupOrderMode).toBe('random')
    expect(save.contents).toEqual(['post-a'])
    expect(save.image).toEqual(config.image)
  })

  it('keeps existing account flags and order before newly added accounts', () => {
    const config = sampleConfig()
    expect(accountInputsForSelection(config, [20, 10, 30])).toEqual([
      { accountId: 10, enabled: false, sortOrder: 0, postsPerTurn: 4 },
      { accountId: 20, enabled: true, sortOrder: 1, postsPerTurn: null },
      { accountId: 30, enabled: true, sortOrder: 2, postsPerTurn: null }
    ])
  })
})
