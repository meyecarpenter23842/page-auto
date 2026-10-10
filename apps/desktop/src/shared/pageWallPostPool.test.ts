import { describe, expect, it } from 'vitest'
import {
  normalizePageWallSchedulePostPool,
  selectPageWallSchedulePost,
  type PageWallSchedulePostPoolRecord
} from './pageWallPostPool'

function pool(mode: 'sequential' | 'random'): PageWallSchedulePostPoolRecord {
  return {
    groupKey: 'wall-pool:test',
    slotOrder: 0,
    mode,
    posts: [
      { kind: 'canonical', postId: 11, variantIndex: 0 },
      { kind: 'canonical', postId: 22, variantIndex: 0 },
      { kind: 'canonical', postId: 33, variantIndex: 0 }
    ]
  }
}

describe('Page Wall schedule post pool', () => {
  it('normalizes unique canonical posts and rejects an empty pool', () => {
    expect(normalizePageWallSchedulePostPool({
      mode: 'sequential',
      posts: [
        { kind: 'canonical', postId: 11, variantIndex: 0 },
        { kind: 'canonical', postId: 11, variantIndex: 1 },
        { kind: 'canonical', postId: 22, variantIndex: 2 }
      ]
    }).posts).toEqual([
      { kind: 'canonical', postId: 11, variantIndex: 0 },
      { kind: 'canonical', postId: 22, variantIndex: 2 }
    ])

    expect(() => normalizePageWallSchedulePostPool({ mode: 'random', posts: [] }))
      .toThrow('ít nhất một bài')
  })

  it('walks sequentially across slots and keeps going across cycles', () => {
    const value = pool('sequential')
    expect(Array.from({ length: 8 }, (_unused, ordinal) => selectPageWallSchedulePost(value, ordinal).postId))
      .toEqual([11, 22, 33, 11, 22, 33, 11, 22])
  })

  it('randomizes without repeating inside each pool cycle and is restart-stable', () => {
    const value = pool('random')
    const firstCycle = Array.from({ length: 3 }, (_unused, ordinal) => selectPageWallSchedulePost(value, ordinal).postId)
    const secondCycle = Array.from({ length: 3 }, (_unused, offset) => selectPageWallSchedulePost(value, 3 + offset).postId)

    expect(new Set(firstCycle)).toEqual(new Set([11, 22, 33]))
    expect(new Set(secondCycle)).toEqual(new Set([11, 22, 33]))
    expect(Array.from({ length: 6 }, (_unused, ordinal) => selectPageWallSchedulePost(value, ordinal).postId))
      .toEqual([...firstCycle, ...secondCycle])
  })
})
