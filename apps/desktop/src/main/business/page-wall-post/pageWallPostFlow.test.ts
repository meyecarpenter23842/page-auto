import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import type { PreparedPageWallRuntime } from './pageWallTask'

const mocks = vi.hoisted(() => ({
  composerOpen: vi.fn(),
  composerDiagnostics: vi.fn(),
  contentFill: vi.fn(),
  mediaUpload: vi.fn(),
  publishClick: vi.fn(),
  captureBaseline: vi.fn(),
  verify: vi.fn()
}))

vi.mock('../../browser/posting/robustComposerDetector', () => ({
  RobustComposerDetector: class {
    open = mocks.composerOpen
    diagnostics = mocks.composerDiagnostics
  }
}))

vi.mock('../../browser/posting/postingEngine', () => ({
  PostComposer: class {
    fill = mocks.contentFill
  },
  MediaUploader: class {
    upload = mocks.mediaUpload
  }
}))

vi.mock('./pageWallPublishAction', () => ({
  PageWallPublishAction: class {
    click = mocks.publishClick
  }
}))

vi.mock('./pageWallPublishVerifier', () => ({
  PageWallPublishVerifier: class {
    captureBaseline = mocks.captureBaseline
    verify = mocks.verify
  }
}))

import { PageWallPostFlow } from './pageWallPostFlow'

function runtime(): { value: PreparedPageWallRuntime; pace: ReturnType<typeof vi.fn> } {
  const pace = vi.fn(async () => undefined)
  return {
    value: {
      page: { waitForTimeout: vi.fn(async () => undefined) } as unknown as Page,
      browser: { navigationTimeoutMs: 45_000, pageSettleDelayMs: 700 },
      pace,
      checkAccessBlock: vi.fn(async () => ({ status: 'success' as const, message: 'ok' }))
    },
    pace
  }
}

describe('PageWallPostFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.captureBaseline.mockResolvedValue({ captured: true, postKeys: new Set(['post:1']) })
    mocks.composerOpen.mockResolvedValue({ container: { kind: 'container' }, textbox: { kind: 'textbox' } })
    mocks.composerDiagnostics.mockResolvedValue('diagnostics')
    mocks.contentFill.mockResolvedValue({ status: 'success', message: 'content ready' })
    mocks.mediaUpload.mockResolvedValue({ status: 'success', message: 'media ready' })
    mocks.publishClick.mockResolvedValue({ status: 'success', message: 'publish sent' })
    mocks.verify.mockResolvedValue({
      status: 'success',
      message: 'verified',
      publishedUrl: 'https://www.facebook.com/90001/posts/2'
    })
  })

  it('runs baseline -> composer -> content -> media -> wall publish action -> wall verification', async () => {
    const prepared = runtime()
    const result = await new PageWallPostFlow(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      30_000
    ).execute('hello wall', ['C:\\images\\one.jpg'])

    expect(mocks.captureBaseline).toHaveBeenCalledTimes(1)
    expect(prepared.pace).toHaveBeenNthCalledWith(1, 'wall-to-composer')
    expect(mocks.composerOpen).toHaveBeenCalledTimes(1)
    expect(mocks.contentFill).toHaveBeenCalledWith({ kind: 'textbox' }, 'hello wall')
    expect(mocks.mediaUpload).toHaveBeenCalledWith({ kind: 'container' }, ['C:\\images\\one.jpg'])
    expect(prepared.pace).toHaveBeenNthCalledWith(2, 'media-to-publish')
    expect(mocks.publishClick).toHaveBeenCalledWith({ kind: 'container' })
    expect(mocks.verify).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('success')
  })

  it('supports image-only wall posts without forcing the text composer primitive', async () => {
    const prepared = runtime()
    const result = await new PageWallPostFlow(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      30_000
    ).execute('', ['C:\\images\\only.jpg'])

    expect(mocks.contentFill).not.toHaveBeenCalled()
    expect(mocks.mediaUpload).toHaveBeenCalledTimes(1)
    expect(mocks.publishClick).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('success')
  })

  it('does not click publish when the verification baseline cannot be captured', async () => {
    mocks.captureBaseline.mockResolvedValueOnce({ captured: false, postKeys: new Set() })
    const prepared = runtime()

    const result = await new PageWallPostFlow(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      30_000
    ).execute('hello wall', [])

    expect(result).toMatchObject({ status: 'failed', code: 'publish_unconfirmed' })
    expect(mocks.composerOpen).not.toHaveBeenCalled()
    expect(mocks.publishClick).not.toHaveBeenCalled()
  })

  it('stops before verification when the wall publish action itself fails', async () => {
    mocks.publishClick.mockResolvedValueOnce({
      status: 'failed',
      code: 'publish_action_failed',
      message: 'button disabled'
    })
    const prepared = runtime()

    const result = await new PageWallPostFlow(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      30_000
    ).execute('hello wall', [])

    expect(result).toMatchObject({ status: 'failed', code: 'publish_action_failed' })
    expect(mocks.verify).not.toHaveBeenCalled()
  })
})
