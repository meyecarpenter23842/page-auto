import { describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import type { PageWallPostTaskDescriptor } from '../../../shared/facebookTasks'
import type { PostingJobResult } from '../../../shared/posting'
import {
  PageWallTask,
  pageWallUrl,
  type PageWallPostFlowFactory,
  type PreparedPageWallRuntime
} from './pageWallTask'

function task(pageUid = '90001'): PageWallPostTaskDescriptor {
  return {
    type: 'page_wall_post',
    target: { kind: 'page_wall', pageUid }
  }
}

function runtime(overrides: Partial<PreparedPageWallRuntime> = {}): {
  value: PreparedPageWallRuntime
  goto: ReturnType<typeof vi.fn>
  waitForTimeout: ReturnType<typeof vi.fn>
  pace: ReturnType<typeof vi.fn>
  checkAccessBlock: ReturnType<typeof vi.fn>
} {
  const goto = vi.fn(async () => null)
  const waitForTimeout = vi.fn(async () => undefined)
  const pace = vi.fn(async () => undefined)
  const checkAccessBlock = vi.fn(async () => ({ status: 'success' as const, message: 'ok' }))
  return {
    value: {
      page: { goto, waitForTimeout } as unknown as Page,
      browser: { navigationTimeoutMs: 45_000, pageSettleDelayMs: 700 },
      pace,
      checkAccessBlock,
      ...overrides
    },
    goto,
    waitForTimeout,
    pace,
    checkAccessBlock
  }
}

describe('PageWallTask', () => {
  it('builds a Page wall URL from Page UID', () => {
    expect(pageWallUrl(' 90001 ')).toBe('https://www.facebook.com/profile.php?id=90001')
  })

  it('uses only the prepared runtime to open the Page wall surface', async () => {
    const prepared = runtime()
    const result = await new PageWallTask(prepared.value, task()).prepare()

    expect(prepared.pace).toHaveBeenCalledWith('page-to-wall')
    expect(prepared.goto).toHaveBeenCalledWith(
      'https://www.facebook.com/profile.php?id=90001',
      { waitUntil: 'domcontentloaded', timeout: 45_000 }
    )
    expect(prepared.waitForTimeout).toHaveBeenCalledWith(700)
    expect(prepared.checkAccessBlock).toHaveBeenCalledWith('sau khi mở Tường Page')
    expect(result.status).toBe('success')
  })

  it('propagates common login/checkpoint policy instead of implementing its own classifier', async () => {
    const prepared = runtime({
      checkAccessBlock: vi.fn(async () => ({
        status: 'needs_login' as const,
        code: 'verification_required' as const,
        message: 'Facebook yêu cầu checkpoint.'
      }))
    })

    await expect(new PageWallTask(prepared.value, task()).prepare()).resolves.toEqual({
      status: 'needs_login',
      code: 'verification_required',
      message: 'Facebook yêu cầu checkpoint.'
    })
  })

  it('maps wall navigation failure to the common page_navigation_failed code', async () => {
    const prepared = runtime()
    prepared.goto.mockRejectedValueOnce(new Error('navigation timeout'))

    await expect(new PageWallTask(prepared.value, task()).prepare()).resolves.toEqual({
      status: 'failed',
      code: 'page_navigation_failed',
      message: 'navigation timeout'
    })
  })

  it('delegates publish only after the prepared Page wall surface is ready', async () => {
    const prepared = runtime()
    const published: PostingJobResult = {
      status: 'success',
      message: 'wall published',
      publishedUrl: 'https://www.facebook.com/90001/posts/123'
    }
    const execute = vi.fn(async () => published)
    const createFlow: PageWallPostFlowFactory = vi.fn(() => ({ execute }))

    const result = await new PageWallTask(prepared.value, task(), createFlow).execute({
      content: 'hello wall',
      imagePaths: ['C:\\images\\one.jpg'],
      networkTimeoutMs: 30_000
    })

    expect(createFlow).toHaveBeenCalledWith(
      prepared.value,
      'https://www.facebook.com/profile.php?id=90001',
      30_000
    )
    expect(execute).toHaveBeenCalledWith('hello wall', ['C:\\images\\one.jpg'])
    expect(result).toEqual(published)
  })

  it('does not construct the publish flow when common access blocks the wall', async () => {
    const prepared = runtime({
      checkAccessBlock: vi.fn(async () => ({
        status: 'needs_login' as const,
        code: 'needs_login' as const,
        message: 'login required'
      }))
    })
    const createFlow: PageWallPostFlowFactory = vi.fn(() => ({
      execute: vi.fn(async () => ({ status: 'success' as const, message: 'unexpected' }))
    }))

    const result = await new PageWallTask(prepared.value, task(), createFlow).execute({
      content: 'hello wall',
      imagePaths: [],
      networkTimeoutMs: 30_000
    })

    expect(createFlow).not.toHaveBeenCalled()
    expect(result.status).toBe('needs_login')
    expect(result.code).toBe('needs_login')
  })
})
