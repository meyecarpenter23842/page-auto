import { describe, expect, it } from 'vitest'
import type { RunItem, RunSnapshot } from '../../shared/runs'
import { selectRunPost } from './postingSelection'

function item(sortOrder: number, id = sortOrder + 1): RunItem {
  return {
    id,
    runId: 7,
    sourceGroupItemId: null,
    groupUid: `group-${sortOrder}`,
    sortOrder,
    status: 'processing',
    attemptCount: 1,
    lastError: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: 0
  }
}

function snapshot(): RunSnapshot {
  return {
    version: 1,
    pageTabId: 1,
    tabName: 'Page A',
    pageUid: '90001',
    rotation: {
      postsPerAccount: 1,
      postDelayMinSeconds: 0,
      postDelayMaxSeconds: 0,
      accountDelayMinSeconds: 0,
      accountDelayMaxSeconds: 0
    },
    accounts: [],
    schedules: [],
    contentMode: 'sequential',
    contents: ['legacy'],
    image: { folderPath: 'D:\\legacy', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' },
    postMode: 'sequential',
    posts: [
      {
        name: 'A',
        enabled: true,
        sortOrder: 0,
        variants: ['A one', 'A two', 'A three'],
        image: { folderPath: 'D:\\a', mode: 'random', imagesPerPost: 2, missingPolicy: 'text_only' }
      },
      {
        name: 'Disabled',
        enabled: false,
        sortOrder: 1,
        variants: ['never'],
        image: { folderPath: 'D:\\disabled', mode: 'random', imagesPerPost: 1, missingPolicy: 'text_only' }
      },
      {
        name: 'B',
        enabled: true,
        sortOrder: 2,
        variants: ['B one', 'B two'],
        image: { folderPath: 'D:\\b', mode: 'sequential', imagesPerPost: 4, missingPolicy: 'skip' }
      }
    ],
    groupSourceCount: 2
  }
}

describe('selectRunPost', () => {
  it('runs enabled posts sequentially while choosing one deterministic variant inside each post', () => {
    const source = snapshot()
    const first = selectRunPost(source, item(0))
    const second = selectRunPost(source, item(1))

    expect(first?.postIndex).toBe(0)
    expect(first?.content.startsWith('A ')).toBe(true)
    expect(first?.image).toMatchObject({ folderPath: 'D:\\a', imagesPerPost: 2 })
    expect(second?.postIndex).toBe(1)
    expect(second?.content.startsWith('B ')).toBe(true)
    expect(second?.image).toMatchObject({ folderPath: 'D:\\b', imagesPerPost: 4, missingPolicy: 'skip' })
    expect(selectRunPost(source, item(0))).toEqual(first)
  })

  it('selects a deterministic enabled post in random mode', () => {
    const source = snapshot()
    source.postMode = 'random'
    const selected = selectRunPost(source, item(4, 99))
    expect(selected).not.toBeNull()
    expect(['D:\\a', 'D:\\b']).toContain(selected?.image.folderPath)
    expect(selectRunPost(source, item(4, 99))).toEqual(selected)
  })

  it('falls back to legacy content/image for snapshots created by older builds', () => {
    const source = snapshot()
    delete source.posts
    delete source.postMode
    const selected = selectRunPost(source, item(0))
    expect(selected).toMatchObject({ content: 'legacy', variantIndex: 0 })
    expect(selected?.image.folderPath).toBe('D:\\legacy')
  })
})
