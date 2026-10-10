import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import type { PreparedPageWallRuntime } from './pageWallTask'

const mocks = vi.hoisted(() => ({
  capturePublishBaseline: vi.fn(),
  findNewPublishedPost: vi.fn(),
  findSingleNewPublishedPost: vi.fn()
}))

vi.mock('../../browser/posting/publishVerification', () => ({
  capturePublishBaseline: mocks.capturePublishBaseline,
  findNewPublishedPost: mocks.findNewPublishedPost,
  findSingleNewPublishedPost: mocks.findSingleNewPublishedPost
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
    mocks.findSingleNewPublishedPost.mockResolvedValue(null)
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
    expect(mocks.findSingleNewPublishedPost).not.toHaveBeenCalled()
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

  it('falls back to exactly one new post key after reload when Facebook text scoping changed', async () => {
    mocks.findSingleNewPublishedPost.mockResolvedValueOnce(published)
    const prepared = runtime()
    const verifier = new PageWallPublishVerifier(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      1_000
    )

    const result = await verifier.verify('nội dung dài cần verify', baseline)

    expect(mocks.findSingleNewPublishedPost).toHaveBeenCalledWith(prepared.value.page, baseline)
    expect(prepared.checkAccessBlock).toHaveBeenCalledWith('sau khi xác minh post key mới trên Tường Page')
    expect(result).toMatchObject({
      status: 'success',
      publishedUrl: published.publishedUrl
    })
    expect(result.message).toContain('đúng một bài mới theo post key')
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

  it('uses the completed owned post-submit CTA as a final confirmation fallback', async () => {
    const prepared = runtime()
    const verifier = new PageWallPublishVerifier(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      1_000
    )

    const result = await verifier.verify('hello wall', baseline, {
      postSubmitPromptCompleted: true
    })

    expect(mocks.findSingleNewPublishedPost).toHaveBeenCalledTimes(1)
    expect(prepared.checkAccessBlock).toHaveBeenCalledWith('sau khi hoàn tất popup hậu Đăng Tường')
    expect(result).toMatchObject({ status: 'success' })
    expect(result.message).toContain('popup hậu Đăng')
    expect(result.message).toContain('Không gửi lại Post')
    expect(result.publishedUrl).toBeUndefined()
  })

  it('keeps publish_unconfirmed when neither wall evidence nor post-submit confirmation exists', async () => {
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
    expect(mocks.findSingleNewPublishedPost).toHaveBeenCalledTimes(1)
  })

  it('does not return CTA fallback success when a checkpoint is present after publish', async () => {
    const checkAccessBlock: PreparedPageWallRuntime['checkAccessBlock'] = vi.fn(async (context) => {
      if (context === 'khi xác minh bài mới trên Tường Page') {
        return { status: 'success' as const, message: 'ok' }
      }
      return {
        status: 'needs_login' as const,
        code: 'verification_required' as const,
        message: 'checkpoint'
      }
    })
    const prepared = runtime(checkAccessBlock)
    const verifier = new PageWallPublishVerifier(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      1_000
    )

    const result = await verifier.verify('hello wall', baseline, {
      postSubmitPromptCompleted: true
    })

    expect(result.status).toBe('needs_login')
    expect(result.code).toBe('verification_required')
    expect(result.message).toContain('review Tường Page trước khi retry')
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
    expect(mocks.findSingleNewPublishedPost).not.toHaveBeenCalled()
  })
})
