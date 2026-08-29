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
  it('cycles enabled posts and their variants without consuming either list', () => {
    const source = snapshot()
    const selected = Array.from({ length: 8 }, (_, index) => selectRunPost(source, item(index)))

    expect(selected.map((entry) => [entry?.postIndex, entry?.variantIndex, entry?.content])).toEqual([
      [0, 0, 'A one'],
      [1, 0, 'B one'],
      [0, 1, 'A two'],
      [1, 1, 'B two'],
      [0, 2, 'A three'],
      [1, 0, 'B one'],
      [0, 0, 'A one'],
      [1, 1, 'B two']
    ])
    expect(selected[0]?.image).toMatchObject({ folderPath: 'D:\\a', imagesPerPost: 2 })
    expect(selected[1]?.image).toMatchObject({ folderPath: 'D:\\b', imagesPerPost: 4, missingPolicy: 'skip' })
  })

  it('reuses a single post variant forever instead of exhausting content', () => {
    const source = snapshot()
    source.posts = [{ ...source.posts![0]!, variants: ['only one'] }]

    for (let index = 0; index < 25; index += 1) {
      expect(selectRunPost(source, item(index))?.content).toBe('only one')
    }
  })

  it('selects random posts and variants with replacement while staying stable for the same run item', () => {
    const source = snapshot()
    source.postMode = 'random'
    const selections = Array.from({ length: 40 }, (_, index) => selectRunPost(source, item(index, 100 + index)))

    expect(selections.every(Boolean)).toBe(true)
    expect(selections.every((entry) => entry ? ['D:\\a', 'D:\\b'].includes(entry.image.folderPath) : false)).toBe(true)
    const selected = selectRunPost(source, item(4, 99))
    expect(selectRunPost(source, item(4, 99))).toEqual(selected)
  })

  it('keeps media-only Content Library posts selectable', () => {
    const source = snapshot()
    source.posts = [{
      name: 'Chỉ ảnh',
      enabled: true,
      sortOrder: 0,
      variants: [],
      image: { folderPath: 'D:\\media-only', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'skip' }
    }]
    const selected = selectRunPost(source, item(0))
    expect(selected).toMatchObject({ content: '', postIndex: 0, variantIndex: 0 })
    expect(selected?.image.folderPath).toBe('D:\\media-only')
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
