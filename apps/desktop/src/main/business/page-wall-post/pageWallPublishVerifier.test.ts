import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import type { PreparedPageWallRuntime } from './pageWallTask'

const mocks = vi.hoisted(() => ({
  capturePublishBaseline: vi.fn(),
  findNewPublishedPost: vi.fn()
}))

vi.mock('../../browser/posting/publishVerification', () => ({
  capturePublishBaseline: mocks.capturePublishBaseline,
  findNewPublishedPost: mocks.findNewPublishedPost
}))

import { PageWallPublishVerifier } from './pageWallPublishVerifier'

function runtime(
  checkAccessBlock: PreparedPageWallRuntime['checkAccessBlock'] = vi.fn(async () => ({
    status: 'success' as const,
    message: 'ok'
  }))
) {
  const goto = vi.fn(async () => null)
  const waitForTimeout = vi.fn(async () => undefined)
  const value: PreparedPageWallRuntime = {
    page: { goto, waitForTimeout } as unknown as Page,
    browser: { navigationTimeoutMs: 45_000, pageSettleDelayMs: 700 },
    pace: vi.fn(async () => undefined),
    checkAccessBlock
  }
  return { value, goto, waitForTimeout, checkAccessBlock }
}

const baseline = { captured: true, postKeys: new Set(['post:1']) }
const published = {
  postKey: 'post:pfbidNewPagePost',
  publishedUrl: 'https://www.facebook.com/ExamplePage/posts/pfbidNewPagePost'
}

describe('PageWallPublishVerifier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.capturePublishBaseline.mockResolvedValue(baseline)
    mocks.findNewPublishedPost.mockResolvedValue(null)
  })

  it('captures a pre-publish baseline from the current Page wall', async () => {
    const prepared = runtime()
    const verifier = new PageWallPublishVerifier(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      1_000
    )

    await expect(verifier.captureBaseline()).resolves.toEqual(baseline)
    expect(mocks.capturePublishBaseline).toHaveBeenCalledWith(prepared.value.page)
  })

  it('accepts current-DOM evidence only after the common access gate remains clear', async () => {
    mocks.findNewPublishedPost.mockResolvedValueOnce(published)
    const prepared = runtime()
    const verifier = new PageWallPublishVerifier(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      1_000
    )

    await expect(verifier.verify('short', baseline)).resolves.toMatchObject({
      status: 'success',
      publishedUrl: published.publishedUrl
    })
    expect(prepared.goto).not.toHaveBeenCalled()
    expect(prepared.checkAccessBlock).toHaveBeenCalledWith('sau khi phát hiện bài mới trên Tường Page')
    expect(mocks.findNewPublishedPost).toHaveBeenCalledWith(
      prepared.value.page,
      'short',
      baseline,
      false,
      12,
      true
    )
  })

  it('reloads the same Page wall and verifies again when immediate DOM evidence is absent', async () => {
    mocks.findNewPublishedPost
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(published)
    const prepared = runtime()
    const verifier = new PageWallPublishVerifier(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      1_000
    )

    const result = await verifier.verify('hello wall', baseline)

    expect(prepared.goto).toHaveBeenCalledWith(
      'https://www.facebook.com/profile.php?id=90001',
      { waitUntil: 'domcontentloaded', timeout: 45_000 }
    )
    expect(prepared.checkAccessBlock).toHaveBeenCalledWith('khi xác minh bài mới trên Tường Page')
    expect(prepared.checkAccessBlock).toHaveBeenCalledWith('sau khi xác minh bài mới trên Tường Page')
    expect(result).toMatchObject({ status: 'success', publishedUrl: published.publishedUrl })
  })

  it('uses new post-key evidence for image-only posts without weakening text verification', async () => {
    mocks.findNewPublishedPost.mockResolvedValueOnce(published)
    const prepared = runtime()
    const verifier = new PageWallPublishVerifier(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      1_000
    )

    await verifier.verify('', baseline)

    expect(mocks.findNewPublishedPost).toHaveBeenCalledWith(
      prepared.value.page,
      '',
      baseline,
      true,
      12,
      false
    )
  })

  it('returns publish_unconfirmed instead of treating the click as success when evidence never appears', async () => {
    const prepared = runtime()
    const verifier = new PageWallPublishVerifier(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      1_000
    )

    await expect(verifier.verify('hello wall', baseline)).resolves.toMatchObject({
      status: 'failed',
      code: 'publish_unconfirmed'
    })
  })

  it('does not return success when a checkpoint overlay appears after immediate post evidence', async () => {
    mocks.findNewPublishedPost.mockResolvedValueOnce(published)
    const checkAccessBlock: PreparedPageWallRuntime['checkAccessBlock'] = vi.fn(async () => ({
      status: 'needs_login' as const,
      code: 'verification_required' as const,
      message: 'checkpoint'
    }))
    const prepared = runtime(checkAccessBlock)
    const verifier = new PageWallPublishVerifier(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      1_000
    )

    const result = await verifier.verify('hello wall', baseline)

    expect(prepared.goto).not.toHaveBeenCalled()
    expect(result.status).toBe('needs_login')
    expect(result.code).toBe('verification_required')
    expect(result.message).toContain('review Tường Page trước khi retry')
  })

  it('preserves common checkpoint state after reload and warns against blind retry', async () => {
    const checkAccessBlock: PreparedPageWallRuntime['checkAccessBlock'] = vi.fn(async () => ({
      status: 'needs_login' as const,
      code: 'verification_required' as const,
      message: 'checkpoint'
    }))
    const prepared = runtime(checkAccessBlock)
    const verifier = new PageWallPublishVerifier(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      1_000
    )

    const result = await verifier.verify('hello wall', baseline)

    expect(result.status).toBe('needs_login')
    expect(result.code).toBe('verification_required')
    expect(result.message).toContain('review Tường Page trước khi retry')
  })
})
