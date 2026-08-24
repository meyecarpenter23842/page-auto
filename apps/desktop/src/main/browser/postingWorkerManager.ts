import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import { DEFAULT_APP_SETTINGS, type RuntimeSettings } from '../../shared/appSettings'
import {
  cloneDefaultBrowserWindowLayout,
  type BrowserWindowLayoutSettings,
  type BrowserWindowPlacement
} from '../../shared/browserWindowLayout'
import type {
  PostingJobRequest,
  PostingJobResult,
  PostingWorkerMessage,
  PostingWorkerRequestMessage
} from '../../shared/posting'
import { BrowserWindowLayoutManager } from './browserWindowLayoutManager'
import { getManagedBrowserEndpoint } from './managedBrowserRegistry'
import { BrowserLaunchGate } from './runtimeLaunchGate'

const MANAGED_CDP_ARG_PREFIX = '--page-auto-managed-cdp='
const ACCOUNT_SHUTDOWN_TIMEOUT_MS = 5_000

interface PendingJob {
  job: PostingJobRequest
  resolve: (result: PostingJobResult) => void
  timer: NodeJS.Timeout
  sent: boolean
}

interface AccountWorkerEntry {
  accountId: number
  process: UtilityProcess
  ready: boolean
  pending: PendingJob | null
  shuttingDown: boolean
}

function diagnostic(job: PostingJobRequest, message: string): void {
  console.info(`[PAGE-AUTO posting] run=${job.runId} item=${job.itemId} account=${job.accountId} ${message}`)
}

function accountDiagnostic(accountId: number, message: string): void {
  console.info(`[PAGE-AUTO posting] account=${accountId} ${message}`)
}

export class PostingWorkerManager {
  private readonly workers = new Map<number, AccountWorkerEntry>()
  private readonly launchGate = new BrowserLaunchGate()

  constructor(
    private readonly getRuntimeSettings: () => RuntimeSettings = () => ({ ...DEFAULT_APP_SETTINGS.runtime }),
    private readonly windowLayout?: BrowserWindowLayoutManager,
    private readonly getWindowLayoutSettings: () => BrowserWindowLayoutSettings = () => cloneDefaultBrowserWindowLayout()
  ) {}

  async run(job: PostingJobRequest): Promise<PostingJobResult> {
    const runtime = { ...this.getRuntimeSettings() }
    this.windowLayout?.claim(job.accountId, 'posting')
    const placement = this.windowLayout?.placementFor(
      job.accountId,
      this.getWindowLayoutSettings(),
      job.browser
    ) ?? null
    const runtimeJob: PostingJobRequest = { ...job, browserPlacement: placement }
    let entry = this.workers.get(job.accountId)

    if (!entry || entry.shuttingDown) {
      await this.launchGate.wait(runtime.browserLaunchSpacingMs, job.runId)
      try {
        entry = this.spawnWorker(runtimeJob)
      } catch (error) {
        this.windowLayout?.release(job.accountId, 'posting')
        return {
          status: 'failed',
          code: 'worker_crashed',
          message: error instanceof Error ? error.message : String(error)
        }
      }
    } else {
      diagnostic(runtimeJob, 'reuse posting worker hiện có')
    }

    if (entry.pending) {
      return {
        status: 'failed',
        code: 'unexpected_error',
        message: `Posting worker của account #${job.accountId} đang bận với job khác.`
      }
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!entry?.pending || entry.pending.job.itemId !== runtimeJob.itemId) return
        diagnostic(runtimeJob, `TIMEOUT sau ${runtime.maxAccountRuntimeSeconds}s`)
        const pending = entry.pending
        entry.pending = null
        this.workers.delete(job.accountId)
        this.windowLayout?.release(job.accountId, 'posting')
        entry.shuttingDown = true
        entry.process.kill()
        pending.resolve({
          status: 'failed',
          code: 'worker_timeout',
          message: `Posting worker vượt giới hạn runtime ${runtime.maxAccountRuntimeSeconds}s; cần review trước khi retry để tránh đăng trùng.`
        })
      }, runtime.maxAccountRuntimeSeconds * 1000)

      entry.pending = { job: runtimeJob, resolve, timer, sent: false }
      this.dispatch(entry)
    })
  }

  async closeAccount(accountId: number): Promise<void> {
    const entry = this.workers.get(accountId)
    if (!entry) {
      this.windowLayout?.release(accountId, 'posting')
      return
    }
    if (entry.pending) {
      throw new Error(`Không thể đóng Chrome account #${accountId} khi posting job vẫn đang chạy.`)
    }

    accountDiagnostic(accountId, 'RELEASE account turn → shutdown worker/browser')
    entry.shuttingDown = true

    await new Promise<void>((resolve) => {
      let settled = false
      let forceTimer: NodeJS.Timeout | null = null
      let killSettleTimer: NodeJS.Timeout | null = null

      const finish = (): void => {
        if (settled) return
        settled = true
        if (forceTimer) clearTimeout(forceTimer)
        if (killSettleTimer) clearTimeout(killSettleTimer)
        if (this.workers.get(accountId) === entry) this.workers.delete(accountId)
        this.windowLayout?.release(accountId, 'posting')
        resolve()
      }

      entry.process.once('exit', finish)
      forceTimer = setTimeout(() => {
        accountDiagnostic(accountId, 'shutdown grace timeout → force kill worker')
        try {
          entry.process.kill()
        } finally {
          killSettleTimer = setTimeout(finish, 250)
        }
      }, ACCOUNT_SHUTDOWN_TIMEOUT_MS)

      try {
        entry.process.postMessage({ type: 'shutdown' })
      } catch {
        try {
          entry.process.kill()
        } finally {
          killSettleTimer = setTimeout(finish, 250)
        }
      }
    })

    accountDiagnostic(accountId, 'RELEASE complete → Chrome/worker closed')
  }

  retile(placements: Map<number, BrowserWindowPlacement>): number {
    let applied = 0
    for (const [accountId, entry] of this.workers) {
      if (entry.shuttingDown) continue
      const placement = placements.get(accountId)
      if (!placement) continue
      try {
        entry.process.postMessage({ type: 'retile', placement })
        applied += 1
      } catch {
        // Worker exit handler cleans stale entries.
      }
    }
    return applied
  }

  closeAll(): void {
    for (const [accountId, entry] of this.workers) {
      entry.shuttingDown = true
      try {
        entry.process.postMessage({ type: 'shutdown' })
      } catch {
        entry.process.kill()
        this.windowLayout?.release(accountId, 'posting')
        continue
      }
      setTimeout(() => entry.process.kill(), 500)
      this.windowLayout?.release(accountId, 'posting')
    }
    this.workers.clear()
  }

  private spawnWorker(job: PostingJobRequest): AccountWorkerEntry {
    const managedEndpoint = getManagedBrowserEndpoint(job.accountId)
    const workerArgs = managedEndpoint ? [`${MANAGED_CDP_ARG_PREFIX}${managedEndpoint}`] : []
    const worker = utilityProcess.fork(join(__dirname, 'posting-worker.js'), workerArgs, {
      serviceName: `PAGE-AUTO posting account ${job.accountId}`
    })
    const entry: AccountWorkerEntry = {
      accountId: job.accountId,
      process: worker,
      ready: false,
      pending: null,
      shuttingDown: false
    }
    this.workers.set(job.accountId, entry)
    diagnostic(job, managedEndpoint ? 'spawn worker + attach Chrome managed' : 'spawn worker + sẽ mở persistent Chrome')

    worker.on('message', (raw: unknown) => {
      const message = raw as PostingWorkerMessage
      if (message.type === 'ready') {
        entry.ready = true
        const pending = entry.pending
        if (pending) diagnostic(pending.job, 'worker READY')
        this.dispatch(entry)
        return
      }
      if (message.type === 'result') {
        const pending = entry.pending
        if (!pending) return
        clearTimeout(pending.timer)
        entry.pending = null
        diagnostic(pending.job, `RESULT status=${message.result.status} code=${message.result.code ?? 'none'} — ${message.result.message}`)
        pending.resolve(message.result)
      }
    })

    worker.once('exit', (code) => {
      if (this.workers.get(job.accountId) === entry) this.workers.delete(job.accountId)
      this.windowLayout?.release(job.accountId, 'posting')
      const pending = entry.pending
      entry.pending = null
      if (!pending) return
      clearTimeout(pending.timer)
      diagnostic(pending.job, `WORKER EXIT code=${code}`)
      pending.resolve({
        status: 'failed',
        code: 'worker_crashed',
        message: `Posting worker thoát với code ${code}; trạng thái publish có thể chưa xác định, cần review trước khi retry.`
      })
    })

    return entry
  }

  private dispatch(entry: AccountWorkerEntry): void {
    const pending = entry.pending
    if (!entry.ready || !pending || pending.sent || entry.shuttingDown) return
    pending.sent = true
    const request: PostingWorkerRequestMessage = { type: 'execute', job: pending.job }
    diagnostic(pending.job, 'SEND execute → posting engine')
    try {
      entry.process.postMessage(request)
    } catch (error) {
      clearTimeout(pending.timer)
      entry.pending = null
      this.workers.delete(entry.accountId)
      this.windowLayout?.release(entry.accountId, 'posting')
      entry.shuttingDown = true
      entry.process.kill()
      pending.resolve({
        status: 'failed',
        code: 'worker_crashed',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
