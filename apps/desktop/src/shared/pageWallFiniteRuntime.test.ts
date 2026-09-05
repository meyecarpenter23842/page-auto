import { describe, expect, it } from 'vitest'
import { buildPageWallFiniteTasks, normalizePageWallScheduleMinutes } from './pageWallFiniteRuntime'

describe('Page Wall finite task mapping', () => {
  it('materializes an explicit finite round-robin mapping at save time', () => {
    expect(buildPageWallFiniteTasks({
      accountIds: [11, 22],
      taskCount: 5,
      source: { kind: 'canonical', postId: 7, variantIndex: 0 }
    })).toEqual([
      { accountId: 11, source: { kind: 'canonical', postId: 7, variantIndex: 0 }, sortOrder: 0 },
      { accountId: 22, source: { kind: 'canonical', postId: 7, variantIndex: 0 }, sortOrder: 1 },
      { accountId: 11, source: { kind: 'canonical', postId: 7, variantIndex: 0 }, sortOrder: 2 },
      { accountId: 22, source: { kind: 'canonical', postId: 7, variantIndex: 0 }, sortOrder: 3 },
      { accountId: 11, source: { kind: 'canonical', postId: 7, variantIndex: 0 }, sortOrder: 4 }
    ])
  })

  it('rejects an empty selection instead of inventing an account', () => {
    expect(() => buildPageWallFiniteTasks({ accountIds: [], taskCount: 1, source: { kind: 'manual', content: 'A', imagePaths: [] } })).toThrow('ít nhất một tài khoản')
  })
})

describe('Page Wall FPlus-style multi-time schedule', () => {
  it('deduplicates and sorts finite plan slots for one visible schedule', () => {
    expect(normalizePageWallScheduleMinutes([1200, 480, 1200, 750])).toEqual([480, 750, 1200])
  })

  it('rejects an empty or oversized time list', () => {
    expect(() => normalizePageWallScheduleMinutes([])).toThrow('ít nhất một giờ chạy')
    expect(() => normalizePageWallScheduleMinutes(Array.from({ length: 13 }, (_value, index) => index * 30))).toThrow('tối đa 12 giờ')
  })
})
