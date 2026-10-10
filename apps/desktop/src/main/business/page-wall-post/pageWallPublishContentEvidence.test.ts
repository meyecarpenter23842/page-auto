import { describe, expect, it } from 'vitest'
import {
  pageWallContentCountIncreased,
  pageWallFingerprintCountIncreased,
  type PageWallContentBaseline
} from './pageWallPublishContentEvidence'

const baseline: PageWallContentBaseline = {
  captured: true,
  fingerprint: 'Bài mới cần xác minh sau khi Facebook đăng thành',
  matchCount: 1,
  fingerprintMatchCount: 1
}

describe('Page Wall content-count publish evidence', () => {
  it('confirms when the same exact content gains a new main-surface match', () => {
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

  it('confirms when Facebook splits/truncates the body but the owned fingerprint count increases', () => {
    expect(pageWallFingerprintCountIncreased(
      baseline,
      'Bài mới cần xác minh sau khi Facebook đăng thành công',
      2
    )).toBe(true)
    expect(pageWallFingerprintCountIncreased(
      baseline,
      'Bài mới cần xác minh sau khi Facebook đăng thành công',
      1
    )).toBe(false)
  })

  it('does not reuse a baseline captured for different runtime content', () => {
    expect(pageWallContentCountIncreased(baseline, 'Nội dung khác', 2)).toBe(false)
    expect(pageWallFingerprintCountIncreased(baseline, 'Nội dung khác', 2)).toBe(false)
  })

  it('does not use a weak short substring as fingerprint evidence', () => {
    const shortBaseline: PageWallContentBaseline = {
      captured: true,
      fingerprint: 'Ngắn',
      matchCount: 0,
      fingerprintMatchCount: 0
    }
    expect(pageWallFingerprintCountIncreased(shortBaseline, 'Ngắn', 1)).toBe(false)
  })

  it('rejects an uncaptured baseline', () => {
    expect(pageWallContentCountIncreased({
      captured: false,
      fingerprint: baseline.fingerprint,
      matchCount: 0,
      fingerprintMatchCount: 0
    }, 'Bài mới cần xác minh sau khi Facebook đăng thành công', 1)).toBe(false)
  })
})
