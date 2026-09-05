import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAGE_TAB_IMAGE, DEFAULT_PAGE_TAB_ROTATION, type PageTabConfig } from '../../shared/pageTabs'
import type { PageWallExecutionInput } from '../../shared/pageWall'
import type { PostingJobResult } from '../../shared/posting'
import { PageWallRunNowService } from './pageWallRunNowService'

describe('PageWallRunNowService canonical Page account binding', () => {
  it('resolves the first enabled canonical Page account by sortOrder when Wall does not supply an account selector', async () => {
    const config: PageTabConfig = {
      id: 7,
      name: 'Page A',
      pageUid: '90001',
      status: 'idle',
      rotation: { ...DEFAULT_PAGE_TAB_ROTATION },
      accounts: [
        { accountId: 11, enabled: false, sortOrder: 0, postsPerTurn: null, uid: '10001', name: 'Disabled', status: 'valid', category: null },
        { accountId: 22, enabled: true, sortOrder: 1, postsPerTurn: null, uid: '10002', name: 'Primary', status: 'valid', category: null },
        { accountId: 33, enabled: true, sortOrder: 2, postsPerTurn: null, uid: '10003', name: 'Secondary', status: 'valid', category: null }
      ],
      schedules: [],
      groupUids: [],
      contentMode: 'sequential',
      contents: [],
      image: { ...DEFAULT_PAGE_TAB_IMAGE },
      createdAt: 1,
      updatedAt: 1
    }
    const executePageWallPostNow = vi.fn(async (_input: PageWallExecutionInput): Promise<PostingJobResult> => ({ status: 'success', message: 'published' }))
    const service = new PageWallRunNowService({ get: () => config }, { executePageWallPostNow })

    const result = await service.execute({ pageTabId: 7, content: 'hello', imagePaths: [] })

    expect(result).toMatchObject({ status: 'success', accountId: 22 })
    expect(executePageWallPostNow).toHaveBeenCalledWith({
      accountId: 22,
      pageUid: '90001',
      content: 'hello',
      imagePaths: []
    })
  })
})
