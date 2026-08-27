import type { PageWallExecutionInput, PageWallRunNowPayload } from '../../shared/pageWall'
import type { PageWallJobIdPayload, PageWallJobRecord, PageWallSchedulePayload } from '../../shared/pageWallJobs'
import type { PostingJobResult } from '../../shared/posting'
import { PageWallJobRepository } from '../database/pageWallJobRepository'
import type { PageWallPreparationResult } from './pageWallRunNowService'

interface PageWallJobPreparer {
  prepare(payload: PageWallRunNowPayload): PageWallPreparationResult
}

interface PageWallScheduledExecutor {
  executePageWallPostNow(input: PageWallExecutionInput): Promise<PostingJobResult>
}

interface PageWallSchedulerOptions {
  pollIntervalMs?: number
  autoStart?: boolean
  now?: () => number
}

interface ActiveScheduledJob {
  pageTabId: number
  promise: Promise<void>
}

export class PageWallSchedulerService {
  private readonly active = new Map<number, ActiveScheduledJob>()
  private readonly pollIntervalMs: number
  private readonly now: () => number
  private timer: NodeJS.Timeout | null = null
  private claiming = false
  private disposed = false

  constructor(
    private readonly jobs: PageWallJobRepository,
    private readonly preparer: PageWallJobPreparer,
    private readonly executor: PageWallScheduledExecutor,
    private readonly getMaxConcurrent: () => number = () => 1,
    options: PageWallSchedulerOptions = {}
  ) {
    this.pollIntervalMs = Math.max(250, Math.floor(options.pollIntervalMs ?? 1_000))
    this.now = options.now ?? (() => Date.now())
    this.jobs.recoverInterruptedRunning(this.now())
    if (options.autoStart !== false) this.start()
  }

  create(payload: PageWallSchedulePayload): PageWallJobRecord {
    if (!Number.isFinite(payload.scheduledAt) || payload.scheduledAt <= this.now()) {
      throw new Error('Thời gian Hẹn đăng phải nằm trong tương lai.')
    }

    const preparation = this.preparer.prepare(payload)
    if (!preparation.ok) throw new Error(preparation.result.message)
    const prepared = preparation.prepared
    const job = this.jobs.create({
      scheduledAt: payload.scheduledAt,
      pageTabId: payload.pageTabId,
      pageTabName: prepared.pageTabName,
      pageUid: prepared.input.pageUid,
      accountId: prepared.input.accountId,
      accountUid: prepared.accountUid,
      accountName: prepared.accountName,
      content: prepared.input.content,
      imagePaths: prepared.input.imagePaths
    }, this.now())
    void this.tick()
    return job
  }

  list(): PageWallJobRecord[] {
    return this.jobs.list()
  }

  cancel(payload: PageWallJobIdPayload): PageWallJobRecord {
    if (!Number.isInteger(payload.jobId) || payload.jobId <= 0) throw new Error('Job Hẹn đăng không hợp lệ.')
    return this.jobs.cancel(payload.jobId, this.now())
  }

  start(): void {
    if (this.disposed || this.timer) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs)
  }

  async tick(now = this.now()): Promise<void> {
    if (this.disposed || this.claiming) return
    this.claiming = true
    try {
      const maxConcurrent = Math.max(1, Math.min(20, Math.floor(this.getMaxConcurrent() || 1)))
      while (!this.disposed && this.active.size < maxConcurrent) {
        const activePageTabs = [...this.active.values()].map((entry) => entry.pageTabId)
        const job = this.jobs.claimNextDue(now, activePageTabs)
        if (!job) break
        this.launch(job)
      }
    } finally {
      this.claiming = false
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private launch(job: PageWallJobRecord): void {
    const promise = this.executeClaimed(job)
      .catch((error) => {
        console.error(`[PAGE-AUTO wall-scheduler] job=${job.id} unexpected scheduler error:`, error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        this.active.delete(job.id)
        if (!this.disposed) void this.tick()
      })
    this.active.set(job.id, { pageTabId: job.pageTabId, promise })
  }

  private async executeClaimed(job: PageWallJobRecord): Promise<void> {
    let result: PostingJobResult
    try {
      result = await this.executor.executePageWallPostNow({
        accountId: job.accountId,
        pageUid: job.pageUid,
        content: job.content,
        imagePaths: [...job.imagePaths]
      })
    } catch (error) {
      result = {
        status: 'failed',
        code: 'unexpected_error',
        message: error instanceof Error ? error.message : String(error)
      }
    }

    // Main may already be disposing/closing SQLite. Leave the claimed job as running;
    // startup recovery will mark it failed without retrying on the next launch.
    if (this.disposed) return
    this.jobs.finish(job.id, result, this.now())
  }
}
