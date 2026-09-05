import { describe, expect, it } from 'vitest'
import { pageWallContentCountIncreased, type PageWallContentBaseline } from './pageWallPublishContentEvidence'

const baseline: PageWallContentBaseline = {
  captured: true,
  fingerprint: 'Bài mới cần xác minh sau khi Facebook đăng thành',
  matchCount: 1
}

describe('Page Wall exact-content count publish evidence', () => {
  it('confirms only when the same content fingerprint gains a new main-surface match', () => {
    expect(pageWallContentCountIncreased(
      baseline,
      'Bài mới cần xác minh sau khi Facebook đăng thành công',
      2
    )).toBe(true)
    expect(pageWallContentCountIncreased(
      baseline,
      'Bài mới cần xác minh sau khi Facebook đăng thành công',
      1
    )).toBe(false)
  })

  it('does not reuse a baseline captured for different runtime content', () => {
    expect(pageWallContentCountIncreased(baseline, 'Nội dung khác', 2)).toBe(false)
  })

  it('rejects an uncaptured baseline', () => {
    expect(pageWallContentCountIncreased({
      captured: false,
      fingerprint: baseline.fingerprint,
      matchCount: 0
    }, 'Bài mới cần xác minh sau khi Facebook đăng thành công', 1)).toBe(false)
  })
})
