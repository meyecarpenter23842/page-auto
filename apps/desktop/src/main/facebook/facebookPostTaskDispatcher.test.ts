import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  groupPostTaskFromLegacy,
  pageWallPostTaskFromBase,
  type FacebookTaskJobBase,
  type PageWallPostTaskJobRequest
} from '../../shared/facebookTasks'
import type { PostingJobRequest } from '../../shared/posting'

const mocks = vi.hoisted(() => ({
  executeGroup: vi.fn(),
  executeWall: vi.fn()
}))

vi.mock('../browser/posting/postingEngine', () => ({
  executePostingJob: mocks.executeGroup
}))

vi.mock('../business/page-wall-post/executePageWallPostJob', () => ({
  executePageWallPostJob: mocks.executeWall
}))

import { executeFacebookPostTaskJob } from './facebookPostTaskDispatcher'

function commonBase(): FacebookTaskJobBase {
  return {
    runId: 10,
    itemId: 20,
    accountId: 30,
    profileDirectory: 'C:\\PageAuto\\profiles\\30',
    pageUid: '90001',
    content: 'hello',
    imagePaths: [],
    browser: {} as FacebookTaskJobBase['browser'],
    session: {} as FacebookTaskJobBase['session'],
    network: {} as FacebookTaskJobBase['network'],
    logging: {} as FacebookTaskJobBase['logging'],
    sessionAccount: {} as FacebookTaskJobBase['sessionAccount']
  }
}

describe('executeFacebookPostTaskJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.executeGroup.mockResolvedValue({ status: 'success', message: 'group ok' })
    mocks.executeWall.mockResolvedValue({ status: 'success', message: 'wall ok' })
  })

  it('keeps legacy Group execution behind the explicit group_post adapter', async () => {
    const legacy = {
      ...commonBase(),
      groupUid: '777'
    } as PostingJobRequest
    const task = groupPostTaskFromLegacy(legacy)

    await expect(executeFacebookPostTaskJob(task)).resolves.toMatchObject({ status: 'success', message: 'group ok' })
    expect(mocks.executeGroup).toHaveBeenCalledWith(legacy)
    expect(mocks.executeWall).not.toHaveBeenCalled()
  })

  it('dispatches page_wall_post directly to the Page Wall executor without synthesizing a Group UID', async () => {
    const task = pageWallPostTaskFromBase(commonBase())

    await expect(executeFacebookPostTaskJob(task)).resolves.toMatchObject({ status: 'success', message: 'wall ok' })
    expect(mocks.executeWall).toHaveBeenCalledWith(task)
    expect(mocks.executeGroup).not.toHaveBeenCalled()
  })

  it('rejects a mismatched Page Wall target before either production executor runs', async () => {
    const task: PageWallPostTaskJobRequest = {
      ...commonBase(),
      executionMode: 'one_shot',
      task: {
        type: 'page_wall_post',
        target: { kind: 'page_wall', pageUid: 'different-page' }
      }
    }

    await expect(executeFacebookPostTaskJob(task)).resolves.toMatchObject({
      status: 'failed',
      code: 'unexpected_error'
    })
    expect(mocks.executeWall).not.toHaveBeenCalled()
    expect(mocks.executeGroup).not.toHaveBeenCalled()
  })
})
