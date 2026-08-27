import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PAGE_TAB_IMAGE,
  DEFAULT_PAGE_TAB_ROTATION,
  type PageTabConfig
} from '../../shared/pageTabs'
import type { PageWallExecutionInput, PageWallRunNowPayload } from '../../shared/pageWall'
import type { PostingJobResult } from '../../shared/posting'
import { PageWallRunNowService } from './pageWallRunNowService'

function pageTab(enabled = true): PageTabConfig {
  return {
    id: 7,
    name: 'Page A',
    pageUid: '90001',
    status: 'idle',
    rotation: { ...DEFAULT_PAGE_TAB_ROTATION },
    accounts: [{
      accountId: 11,
      enabled,
      sortOrder: 0,
      postsPerTurn: null,
      uid: '10001',
      name: 'Operator',
      status: 'valid',
      category: null
    }],
    schedules: [],
    groupUids: [],
    contentMode: 'sequential',
    contents: [],
    image: { ...DEFAULT_PAGE_TAB_IMAGE },
    createdAt: 1,
    updatedAt: 1
  }
}

function payload(patch: Partial<PageWallRunNowPayload> = {}): PageWallRunNowPayload {
  return {
    pageTabId: 7,
    accountId: 11,
    content: 'hello wall',
    imagePaths: [],
    ...patch
  }
}

function setup(config: PageTabConfig | null = pageTab()) {
  const executePageWallPostNow = vi.fn(async (_input: PageWallExecutionInput): Promise<PostingJobResult> => ({
    status: 'success',
    message: 'published',
    publishedUrl: 'https://www.facebook.com/Page/posts/pfbidNew'
  }))
  const service = new PageWallRunNowService(
    { get: vi.fn(() => config) },
    { executePageWallPostNow }
  )
  return { service, executePageWallPostNow }
}

describe('PageWallRunNowService', () => {
  it('uses canonical Page UID from the Page Tab and only forwards secret-free post material', async () => {
    const { service, executePageWallPostNow } = setup()

    const result = await service.execute(payload({
      content: 'hello wall\n',
      imagePaths: [' C:\\media\\one.jpg ', 'C:\\media\\one.jpg', 'C:\\media\\two.webp']
    }))

    expect(executePageWallPostNow).toHaveBeenCalledWith({
      accountId: 11,
      pageUid: '90001',
      content: 'hello wall\n',
      imagePaths: ['C:\\media\\one.jpg', 'C:\\media\\two.webp']
    })
    expect(result).toMatchObject({
      pageTabId: 7,
      accountId: 11,
      status: 'success',
      publishedUrl: 'https://www.facebook.com/Page/posts/pfbidNew'
    })
  })

  it('rejects an account that is not enabled for the selected Page Tab', async () => {
    const { service, executePageWallPostNow } = setup(pageTab(false))

    await expect(service.execute(payload())).resolves.toMatchObject({
      status: 'failed',
      code: 'no_enabled_account'
    })
    expect(executePageWallPostNow).not.toHaveBeenCalled()
  })

  it('requires content or media and rejects unsupported media before opening Facebook', async () => {
    const { service, executePageWallPostNow } = setup()

    await expect(service.execute(payload({ content: '  ', imagePaths: [] }))).resolves.toMatchObject({
      status: 'failed',
      code: 'no_content'
    })
    await expect(service.execute(payload({ content: '', imagePaths: ['C:\\media\\clip.mp4'] }))).resolves.toMatchObject({
      status: 'failed',
      code: 'media_failed'
    })
    expect(executePageWallPostNow).not.toHaveBeenCalled()
  })
})
