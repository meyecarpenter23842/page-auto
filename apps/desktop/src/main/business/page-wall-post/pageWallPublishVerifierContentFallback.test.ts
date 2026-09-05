import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import type { PreparedPageWallRuntime } from './pageWallTask'

const mocks = vi.hoisted(() => ({
  capturePublishBaseline: vi.fn(),
  findNewPublishedPost: vi.fn(),
  findSingleNewPublishedPost: vi.fn(),
  capturePageWallContentBaseline: vi.fn(),
  hasNewPageWallContentEvidence: vi.fn()
}))

vi.mock('../../browser/posting/publishVerification', () => ({
  capturePublishBaseline: mocks.capturePublishBaseline,
  findNewPublishedPost: mocks.findNewPublishedPost,
  findSingleNewPublishedPost: mocks.findSingleNewPublishedPost
}))

vi.mock('./pageWallPublishContentEvidence', () => ({
  capturePageWallContentBaseline: mocks.capturePageWallContentBaseline,
  hasNewPageWallContentEvidence: mocks.hasNewPageWallContentEvidence
}))

import { PageWallPublishVerifier } from './pageWallPublishVerifier'

function runtime() {
  const goto = vi.fn(async () => null)
  const checkAccessBlock = vi.fn(async () => ({ status: 'success' as const, message: 'ok' }))
  const value: PreparedPageWallRuntime = {
    page: {
      goto,
      waitForTimeout: vi.fn(async () => undefined)
    } as unknown as Page,
    browser: { navigationTimeoutMs: 45_000, pageSettleDelayMs: 700 },
    pace: vi.fn(async () => undefined),
    checkAccessBlock
  }
  return { value, goto, checkAccessBlock }
}

describe('PageWallPublishVerifier content-count fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.capturePublishBaseline.mockResolvedValue({ captured: true, postKeys: new Set(['post:old']) })
    mocks.capturePageWallContentBaseline.mockResolvedValue({
      captured: true,
      fingerprint: 'Bài test đăng tường cần đủ dài để làm fingerprint',
      matchCount: 0
    })
    mocks.findNewPublishedPost.mockResolvedValue(null)
    mocks.findSingleNewPublishedPost.mockResolvedValue(null)
    mocks.hasNewPageWallContentEvidence.mockResolvedValue(true)
  })

  it('confirms a real new content match after reload when permalink/post-key wrappers are missing', async () => {
    const prepared = runtime()
    const verifier = new PageWallPublishVerifier(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      1_000
    )
    const content = 'Bài test đăng tường cần đủ dài để làm fingerprint'
    const baseline = await verifier.captureBaseline(content)

    const result = await verifier.verify(content, baseline)

    expect(prepared.goto).toHaveBeenCalledTimes(1)
    expect(mocks.hasNewPageWallContentEvidence).toHaveBeenCalledWith(
      prepared.value.page,
      content,
      baseline.pageWallContent
    )
    expect(mocks.findSingleNewPublishedPost).not.toHaveBeenCalled()
    expect(prepared.checkAccessBlock).toHaveBeenCalledWith('sau khi xác minh content-count mới trên Tường Page')
    expect(result).toMatchObject({ status: 'success' })
    expect(result.message).toContain('nội dung exact trên main surface')
  })

  it('keeps conservative publish_unconfirmed when the matching-content count did not increase', async () => {
    mocks.hasNewPageWallContentEvidence.mockResolvedValueOnce(false)
    const prepared = runtime()
    const verifier = new PageWallPublishVerifier(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      1_000
    )
    const content = 'Bài test đăng tường cần đủ dài để làm fingerprint'
    const baseline = await verifier.captureBaseline(content)

    const result = await verifier.verify(content, baseline)

    expect(result).toMatchObject({ status: 'failed', code: 'publish_unconfirmed' })
    expect(mocks.findSingleNewPublishedPost).toHaveBeenCalledTimes(1)
  })
})
