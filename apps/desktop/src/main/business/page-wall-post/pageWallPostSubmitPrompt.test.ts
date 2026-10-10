import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Locator, Page } from 'playwright-core'
import type { PreparedPageWallRuntime } from './pageWallTask'
import type { PageWallOptionalCtaPromptResolution } from './pageWallPublishAction'

const mocks = vi.hoisted(() => ({
  resolvePrompt: vi.fn(),
  formatPrompt: vi.fn(() => 'title=1 add=1 dismiss=1')
}))

vi.mock('./pageWallPublishAction', () => ({
  resolvePageWallOptionalCtaPrompt: mocks.resolvePrompt,
  formatPageWallOptionalCtaDiagnostics: mocks.formatPrompt
}))

import { PageWallPostSubmitPrompt } from './pageWallPostSubmitPrompt'

function promptResolution(dismissButton: Locator | null): PageWallOptionalCtaPromptResolution {
  return {
    dismissButton,
    titleVisible: dismissButton ? 1 : 0,
    addButtonEnabled: dismissButton ? 1 : 0,
    dismissButtonEnabled: dismissButton ? 1 : 0
  }
}

function runtime(
  checkAccessBlock: PreparedPageWallRuntime['checkAccessBlock'] = vi.fn(async () => ({
    status: 'success' as const,
    message: 'ok'
  }))
) {
  const body = {} as Locator
  const locator = vi.fn(() => body)
  const waitForTimeout = vi.fn(async () => undefined)
  const pace = vi.fn(async () => undefined)
  const value: PreparedPageWallRuntime = {
    page: { locator, waitForTimeout } as unknown as Page,
    browser: { navigationTimeoutMs: 45_000, pageSettleDelayMs: 700 },
    pace,
    checkAccessBlock
  }
  return { value, body, locator, waitForTimeout, pace, checkAccessBlock }
}

describe('PageWallPostSubmitPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('paces and dismisses the owned post-submit CTA with Not now/Để sau', async () => {
    const dismissButton = {
      isVisible: vi.fn(async () => true),
      isEnabled: vi.fn(async () => true),
      click: vi.fn(async () => undefined)
    } as unknown as Locator
    mocks.resolvePrompt.mockResolvedValue(promptResolution(dismissButton))
    const prepared = runtime()

    const outcome = await new PageWallPostSubmitPrompt(prepared.value, 1_000).complete()

    expect(mocks.resolvePrompt).toHaveBeenCalledWith(prepared.body)
    expect(prepared.pace).toHaveBeenCalledTimes(1)
    expect(prepared.pace).toHaveBeenCalledWith('page-wall-post-submit-optional-cta-dismiss')
    expect(dismissButton.click).toHaveBeenCalledTimes(1)
    expect(prepared.checkAccessBlock).toHaveBeenCalledWith('sau khi xử lý popup hậu Đăng Tường')
    expect(outcome).toMatchObject({ observed: true, completed: true, blockingResult: null })
  })

  it('does nothing when the owned CTA never appears', async () => {
    mocks.resolvePrompt.mockResolvedValue(promptResolution(null))
    const prepared = runtime()

    const outcome = await new PageWallPostSubmitPrompt(prepared.value, 1_000).complete()

    expect(prepared.pace).not.toHaveBeenCalled()
    expect(prepared.checkAccessBlock).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ observed: false, completed: false, blockingResult: null })
  })

  it('does not claim completion when the dismiss action disappears before click', async () => {
    const dismissButton = {
      isVisible: vi.fn(async () => false),
      isEnabled: vi.fn(async () => true),
      click: vi.fn(async () => undefined)
    } as unknown as Locator
    mocks.resolvePrompt.mockResolvedValue(promptResolution(dismissButton))
    const prepared = runtime()

    const outcome = await new PageWallPostSubmitPrompt(prepared.value, 1_000).complete()

    expect(prepared.pace).toHaveBeenCalledTimes(1)
    expect(dismissButton.click).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ observed: true, completed: false, blockingResult: null })
  })

  it('continues to wall verification instead of retrying Post when dismiss click fails', async () => {
    const dismissButton = {
      isVisible: vi.fn(async () => true),
      isEnabled: vi.fn(async () => true),
      click: vi.fn(async () => { throw new Error('dialog detached') })
    } as unknown as Locator
    mocks.resolvePrompt.mockResolvedValue(promptResolution(dismissButton))
    const prepared = runtime()

    const outcome = await new PageWallPostSubmitPrompt(prepared.value, 1_000).complete()

    expect(dismissButton.click).toHaveBeenCalledTimes(1)
    expect(outcome).toMatchObject({ observed: true, completed: false, blockingResult: null })
    expect(outcome.message).toContain('Không gửi lại Post')
  })

  it('returns typed attention state when a checkpoint appears after CTA completion', async () => {
    const dismissButton = {
      isVisible: vi.fn(async () => true),
      isEnabled: vi.fn(async () => true),
      click: vi.fn(async () => undefined)
    } as unknown as Locator
    mocks.resolvePrompt.mockResolvedValue(promptResolution(dismissButton))
    const checkAccessBlock: PreparedPageWallRuntime['checkAccessBlock'] = vi.fn(async () => ({
      status: 'needs_login' as const,
      code: 'verification_required' as const,
      message: 'checkpoint'
    }))
    const prepared = runtime(checkAccessBlock)

    const outcome = await new PageWallPostSubmitPrompt(prepared.value, 1_000).complete()

    expect(outcome.observed).toBe(true)
    expect(outcome.completed).toBe(true)
    expect(outcome.blockingResult).toMatchObject({
      status: 'needs_login',
      code: 'verification_required'
    })
    expect(outcome.blockingResult?.message).toContain('review Tường Page trước khi retry')
  })
})
