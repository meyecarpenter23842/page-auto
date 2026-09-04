import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PageWallRunNowPayload } from '../../shared/pageWall'
import type { PostingJobResult } from '../../shared/posting'
import { initializeDatabase } from '../database'
import { PageWallJobRepository } from '../database/pageWallJobRepository'
import type { PageWallPreparationResult } from './pageWallRunNowService'
import { PageWallSchedulerService } from './pageWallSchedulerService'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup(executeResult: PostingJobResult = { status: 'success', message: 'published' }) {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-wall-scheduler-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  const jobs = new PageWallJobRepository(runtime.client)
  let now = 1_000
  const prepare = vi.fn(async (payload: PageWallRunNowPayload): Promise<PageWallPreparationResult> => ({
    ok: true,
    prepared: {
      input: {
        accountId: payload.accountId,
        pageUid: payload.pageTabId === 7 ? '90001' : '90002',
        content: payload.canonicalPost?.content ?? payload.content,
        imagePaths: payload.canonicalPost ? ['C:\\resolved\\canonical.jpg'] : [...payload.imagePaths]
      },
      pageTabName: payload.pageTabId === 7 ? 'Page A' : 'Page B',
      accountUid: payload.accountId === 11 ? '10001' : '10002',
      accountName: null
    }
  }))
  const executePageWallPostNow = vi.fn(async () => executeResult)
  const service = new PageWallSchedulerService(
    jobs,
    { prepare },
    { executePageWallPostNow },
    () => 2,
    { autoStart: false, now: () => now }
  )
  return {
    runtime,
    jobs,
    service,
    prepare,
    executePageWallPostNow,
    setNow: (value: number) => { now = value }
  }
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

describe('PageWallSchedulerService', () => {
  it('persists a validated snapshot and executes the due job through the one-shot production executor', async () => {
    const { runtime, jobs, service, executePageWallPostNow, setNow } = setup({
      status: 'success',
      message: 'published',
      publishedUrl: 'https://www.facebook.com/Page/posts/pfbidScheduled'
    })

    const job = await service.create({
      pageTabId: 7,
      accountId: 11,
      content: 'scheduled content',
      imagePaths: ['C:\\media\\one.jpg'],
      scheduledAt: 2_000
    })
    expect(job.status).toBe('pending')

    setNow(2_000)
    await service.tick()
    await flush()

    expect(executePageWallPostNow).toHaveBeenCalledWith({
      accountId: 11,
      pageUid: '90001',
      content: 'scheduled content',
      imagePaths: ['C:\\media\\one.jpg']
    })
    expect(jobs.get(job.id)).toMatchObject({
      status: 'success',
      resultStatus: 'success',
      publishedUrl: 'https://www.facebook.com/Page/posts/pfbidScheduled'
    })

    service.dispose()
    runtime.close()
  })

  it('freezes canonical material at Hẹn time and never re-reads the live library when the job becomes due', async () => {
    const { runtime, jobs, service, executePageWallPostNow, setNow } = setup()
    const canonicalPost = {
      postId: 101,
      postName: 'Bài dùng chung',
      variantIndex: 0,
      content: 'Snapshot lúc bấm Hẹn',
      image: {
        folderPath: 'C:\\canonical',
        mode: 'sequential' as const,
        imagesPerPost: 1,
        missingPolicy: 'text_only' as const
      }
    }

    const job = await service.create({
      pageTabId: 7,
      accountId: 11,
      content: '',
      imagePaths: [],
      canonicalPost,
      scheduledAt: 2_000
    })

    canonicalPost.content = 'Nội dung thư viện đã đổi sau khi Hẹn'
    canonicalPost.image.folderPath = 'D:\\changed'

    expect(jobs.get(job.id)).toMatchObject({
      content: 'Snapshot lúc bấm Hẹn',
      imagePaths: ['C:\\resolved\\canonical.jpg']
    })

    setNow(2_000)
    await service.tick()
    await flush()

    expect(executePageWallPostNow).toHaveBeenCalledWith({
      accountId: 11,
      pageUid: '90001',
      content: 'Snapshot lúc bấm Hẹn',
      imagePaths: ['C:\\resolved\\canonical.jpg']
    })

    service.dispose()
    runtime.close()
  })

  it('stores login/checkpoint-style one-shot results as failed jobs without converting them back to pending', async () => {
    const { runtime, jobs, service, setNow } = setup({
      status: 'needs_login',
      code: 'needs_login',
      message: 'manual login required',
      sessionValidation: { phase: 'before_run', state: 'needs_login', message: 'login' }
    })
    const job = await service.create({
      pageTabId: 7,
      accountId: 11,
      content: 'scheduled content',
      imagePaths: [],
      scheduledAt: 2_000
    })

    setNow(2_000)
    await service.tick()
    await flush()

    expect(jobs.get(job.id)).toMatchObject({
      status: 'failed',
      resultStatus: 'needs_login',
      resultCode: 'needs_login',
      sessionValidation: { state: 'needs_login' }
    })
    expect(jobs.claimNextDue(3_000)).toBeNull()

    service.dispose()
    runtime.close()
  })

  it('rejects past schedules before persisting a job', async () => {
    const { runtime, jobs, service } = setup()
    await expect(service.create({
      pageTabId: 7,
      accountId: 11,
      content: 'old',
      imagePaths: [],
      scheduledAt: 999
    })).rejects.toThrow('tương lai')
    expect(jobs.list()).toHaveLength(0)
    service.dispose()
    runtime.close()
  })
})
