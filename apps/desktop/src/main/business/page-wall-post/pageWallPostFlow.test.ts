import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import type { PreparedPageWallRuntime } from './pageWallTask'

const mocks = vi.hoisted(() => ({
  composerOpen: vi.fn(),
  composerDiagnostics: vi.fn(),
  contentFill: vi.fn(),
  mediaUpload: vi.fn(),
  publishClick: vi.fn(),
  postSubmitComplete: vi.fn(),
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

vi.mock('./pageWallPostSubmitPrompt', () => ({
  PageWallPostSubmitPrompt: class {
    complete = mocks.postSubmitComplete
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
    mocks.postSubmitComplete.mockResolvedValue({
      observed: false,
      completed: false,
      blockingResult: null,
      message: 'no prompt'
    })
    mocks.verify.mockResolvedValue({
      status: 'success',
      message: 'verified',
      publishedUrl: 'https://www.facebook.com/90001/posts/2'
    })
  })

  it('runs baseline -> composer -> content -> media -> one publish -> post-submit completion -> wall verification', async () => {
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
    expect(mocks.publishClick).toHaveBeenCalledTimes(1)
    expect(mocks.publishClick).toHaveBeenCalledWith({ kind: 'container' })
    expect(mocks.postSubmitComplete).toHaveBeenCalledTimes(1)
    expect(mocks.verify).toHaveBeenCalledWith(
      'hello wall',
      { captured: true, postKeys: new Set(['post:1']) },
      { postSubmitPromptCompleted: false }
    )
    expect(result.status).toBe('success')
  })

  it('uses the exact same trimmed runtimeContent for composer fill and verification', async () => {
    const prepared = runtime()
    await new PageWallPostFlow(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      30_000
    ).execute(' \n  [r3] Nội dung đã spin  \n ', [])

    const filled = mocks.contentFill.mock.calls[0]?.[1]
    const verified = mocks.verify.mock.calls[0]?.[0]
    expect(filled).toBe('[r3] Nội dung đã spin')
    expect(verified).toBe(filled)
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
    expect(mocks.postSubmitComplete).toHaveBeenCalledTimes(1)
    expect(mocks.verify).toHaveBeenCalledWith('', expect.anything(), { postSubmitPromptCompleted: false })
    expect(result.status).toBe('success')
  })

  it('passes the completed post-submit CTA as confirmation without clicking Post again', async () => {
    mocks.postSubmitComplete.mockResolvedValueOnce({
      observed: true,
      completed: true,
      blockingResult: null,
      message: 'dismissed'
    })
    const prepared = runtime()

    await new PageWallPostFlow(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      30_000
    ).execute('hello wall', [])

    expect(mocks.publishClick).toHaveBeenCalledTimes(1)
    expect(mocks.postSubmitComplete).toHaveBeenCalledTimes(1)
    expect(mocks.verify).toHaveBeenCalledWith(
      'hello wall',
      expect.anything(),
      { postSubmitPromptCompleted: true }
    )
  })

  it('stops after a post-submit checkpoint result and never retries Post', async () => {
    mocks.postSubmitComplete.mockResolvedValueOnce({
      observed: true,
      completed: true,
      blockingResult: {
        status: 'needs_login',
        code: 'verification_required',
        message: 'checkpoint after publish; review wall before retry'
      },
      message: 'checkpoint'
    })
    const prepared = runtime()

    const result = await new PageWallPostFlow(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      30_000
    ).execute('hello wall', [])

    expect(mocks.publishClick).toHaveBeenCalledTimes(1)
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'needs_login', code: 'verification_required' })
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
    expect(mocks.postSubmitComplete).not.toHaveBeenCalled()
  })

  it('stops before post-submit completion and verification when the wall publish action itself fails', async () => {
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
    expect(mocks.publishClick).toHaveBeenCalledTimes(1)
    expect(mocks.postSubmitComplete).not.toHaveBeenCalled()
    expect(mocks.verify).not.toHaveBeenCalled()
  })
})
