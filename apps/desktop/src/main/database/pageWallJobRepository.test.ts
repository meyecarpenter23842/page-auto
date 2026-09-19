import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from './index'
import { PageWallJobRepository } from './pageWallJobRepository'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-wall-jobs-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  return { runtime, jobs: new PageWallJobRepository(runtime.client) }
}

function createJob(jobs: PageWallJobRepository, scheduledAt = 2_000) {
  return jobs.create({
    scheduledAt,
    pageTabId: 7,
    pageTabName: 'Page A',
    pageUid: '90001',
    accountId: 11,
    accountUid: '10001',
    accountName: 'Operator',
    content: 'hello scheduled wall',
    imagePaths: ['C:\\media\\one.jpg']
  }, 1_000)
}

describe('PageWallJobRepository', () => {
  it('applies schema v10 and persists the full secret-free schedule snapshot', () => {
    const { runtime, jobs } = setup()
    const schemaVersion = runtime.client.prepare("SELECT value FROM app_settings WHERE key = 'schema_version'").get() as { value: string }
    expect(Number(schemaVersion.value)).toBeGreaterThanOrEqual(10)

    const job = createJob(jobs)
    expect(job).toMatchObject({
      status: 'pending',
      pageTabName: 'Page A',
      pageUid: '90001',
      accountUid: '10001',
      content: 'hello scheduled wall',
      imagePaths: ['C:\\media\\one.jpg']
    })
    expect(job.logs.at(-1)?.message).toContain('Đã tạo lịch')
    runtime.close()
  })

  it('claims due jobs atomically, records result/evidence, and supports pending cancellation', () => {
    const { runtime, jobs } = setup()
    const first = createJob(jobs, 2_000)
    const second = jobs.create({
      scheduledAt: 3_000,
      pageTabId: 8,
      pageTabName: 'Page B',
      pageUid: '90002',
      accountId: 12,
      accountUid: '10002',
      accountName: null,
      content: 'second',
      imagePaths: []
    }, 1_000)

    expect(jobs.claimNextDue(1_999)).toBeNull()
    expect(jobs.claimNextDue(2_000)?.id).toBe(first.id)
    expect(jobs.claimNextDue(2_000)).toBeNull()

    const finished = jobs.finish(first.id, {
      status: 'success',
      message: 'published',
      publishedUrl: 'https://www.facebook.com/Page/posts/pfbidNew',
      screenshotPath: 'C:\\evidence\\wall.png'
    }, 2_500)
    expect(finished).toMatchObject({
      status: 'success',
      resultStatus: 'success',
      resultMessage: 'published',
      publishedUrl: 'https://www.facebook.com/Page/posts/pfbidNew',
      screenshotPath: 'C:\\evidence\\wall.png'
    })

    expect(jobs.cancel(second.id, 2_600).status).toBe('cancelled')
    expect(() => jobs.cancel(first.id, 2_700)).toThrow('Chỉ có thể hủy')
    runtime.close()
  })

  it('fails interrupted running jobs on restart instead of returning them to pending', () => {
    const { runtime, jobs } = setup()
    const job = createJob(jobs, 2_000)
    expect(jobs.claimNextDue(2_000)?.status).toBe('running')

    expect(jobs.recoverInterruptedRunning(5_000)).toBe(1)
    expect(jobs.get(job.id)).toMatchObject({
      status: 'failed',
      resultStatus: 'failed',
      resultCode: 'unexpected_error'
    })
    expect(jobs.claimNextDue(6_000)).toBeNull()
    runtime.close()
  })
})
