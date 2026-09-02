import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import { DEFAULT_APP_SETTINGS, type RuntimeSettings } from '../../shared/appSettings'
import {
  cloneDefaultBrowserWindowLayout,
  type BrowserWindowLayoutSettings,
  type BrowserWindowPlacement
} from '../../shared/browserWindowLayout'
import type {
  EmailCodeResult,
  EmailCodeWorkerRequestMessage,
  EmailCodeWorkerResponseMessage
} from '../../shared/emailCode'
import {
  groupPostTaskFromLegacy,
  type FacebookPostTaskJobRequest,
  type FacebookPostWorkerRequestMessage,
  type FacebookTaskJobBase
} from '../../shared/facebookTasks'
import type {
  PostingJobRequest,
  PostingJobResult,
  PostingWorkerMessage
} from '../../shared/posting'
import { getEmailCodeProvider } from '../services/emailCodeProviderRegistry'
import { configureGlobalBrowserLaunchBroker } from './browserLaunchBroker'
import { BrowserWindowLayoutManager } from './browserWindowLayoutManager'
import { getManagedBrowserEndpoint } from './managedBrowserRegistry'
import { shouldRetainPostingBrowserForManualSession } from './postingWorkerLifecycle'
import { workerProfileReuseDecision } from './workerProfileOwnership'

const MANAGED_CDP_ARG_PREFIX = '--page-auto-managed-cdp='
const ACCOUNT_SHUTDOWN_TIMEOUT_MS = 5_000

interface PendingJob {
  job: FacebookPostTaskJobRequest
  resolve: (result: PostingJobResult) => void
  timer: NodeJS.Timeout
  sent: boolean
}

interface AccountWorkerEntry {
  accountId: number
  profileDirectory: string
  process: UtilityProcess
  ready: boolean
  pending: PendingJob | null
  shuttingDown: boolean
  retainForManualSession: boolean
}

function diagnostic(job: FacebookTaskJobBase, message: string): void {
  console.info(`[PAGE-AUTO posting] run=${job.runId} item=${job.itemId} account=${job.accountId} ${message}`)
}

function accountDiagnostic(accountId: number, message: string): void {
  console.info(`[PAGE-AUTO posting] account=${accountId} ${message}`)
}

function emailSupportError(accountId: number, message: string): EmailCodeResult {
  return {
    accountId,
    status: 'email_support_error',
    code: null,
    receivedAt: null,
    sender: null,
    message
  }
}

export class PostingWorkerManager {
  private readonly workers = new Map<number, AccountWorkerEntry>()

  constructor(
    private readonly getRuntimeSettings: () => RuntimeSettings = () => ({ ...DEFAULT_APP_SETTINGS.runtime }),
    private readonly windowLayout?: BrowserWindowLayoutManager,
    private readonly getWindowLayoutSettings: () => BrowserWindowLayoutSettings = () => cloneDefaultBrowserWindowLayout()
  ) {
    configureGlobalBrowserLaunchBroker(this.getRuntimeSettings)
  }

  run(job: PostingJobRequest): Promise<PostingJobResult> {
    return this.runTask(groupPostTaskFromLegacy(job))
  }

  async runTask(job: FacebookPostTaskJobRequest): Promise<PostingJobResult> {
    const runtime = { ...this.getRuntimeSettings() }
    let entry = this.workers.get(job.accountId)

    if (entry && !entry.shuttingDown) {
      const profileDecision = workerProfileReuseDecision(
        entry.profileDirectory,
        job.profileDirectory,
        Boolean(entry.pending)
      )
      if (profileDecision === 'busy') {
        return {
          status: 'failed',
          code: 'profile_unavailable',
          message: `Facebook Profile Root vừa thay đổi nhưng posting worker của account #${job.accountId} đang bận. Hãy dừng lượt hiện tại rồi chạy lại.`
        }
      }
      if (profileDecision === 'replace') {
        diagnostic(job, 'profile directory changed → restart posting worker/browser before next job')
        // Profile ownership beats manual-session retention. A retained browser from
        // the previous Root must never be reused after settings resolve elsewhere.
        entry.retainForManualSession = false
        await this.closeAccount(job.accountId)
        entry = undefined
      }
    }

    this.windowLayout?.claim(job.accountId, 'posting')
    const placement = this.windowLayout?.placementFor(
      job.accountId,
      this.getWindowLayoutSettings(),
      job.browser
    ) ?? null
    const runtimeJob = { ...job, browserPlacement: placement } as FacebookPostTaskJobRequest

    if (!entry || entry.shuttingDown) {
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
      diagnostic(runtimeJob, entry.retainForManualSession
        ? 'reuse browser được giữ để phục hồi session thủ công'
        : 'reuse posting worker hiện có')
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
      const pending = entry.pending
      clearTimeout(pending.timer)
      entry.pending = null
      entry.retainForManualSession = false
      entry.shuttingDown = true
      if (this.workers.get(accountId) === entry) this.workers.delete(accountId)
      this.windowLayout?.release(accountId, 'posting')
      accountDiagnostic(accountId, 'CANCEL active posting job → force stop worker/browser')
      try {
        entry.process.kill()
      } catch {
        // The pending Promise still settles below; exit cleanup is best-effort.
      }
      pending.resolve({
        status: 'failed',
        code: 'worker_crashed',
        message: 'Posting worker đã bị dừng theo yêu cầu; trạng thái publish có thể chưa xác định, cần review trước khi retry.'
      })
      return
    }
    if (entry.retainForManualSession) {
      accountDiagnostic(accountId, 'KEEP account browser → cần login/checkpoint thủ công; không shutdown persistent browser')
      return
    }

    accountDiagnostic(accountId, 'RELEASE account turn → shutdown worker/browser')
    entry.shuttingDown = true

    let forced = false
    let exitCode: number | null = null
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

      entry.process.once('exit', (code) => {
        exitCode = code
        finish()
      })
      forceTimer = setTimeout(() => {
        forced = true
        accountDiagnostic(accountId, 'shutdown grace timeout → force kill worker; Chrome close chưa được xác nhận')
        try {
          entry.process.kill()
        } finally {
          killSettleTimer = setTimeout(finish, 250)
        }
      }, ACCOUNT_SHUTDOWN_TIMEOUT_MS)

      try {
        entry.process.postMessage({ type: 'shutdown' })
      } catch {
        forced = true
        try {
          entry.process.kill()
        } finally {
          killSettleTimer = setTimeout(finish, 250)
        }
      }
    })

    if (!forced && exitCode === 0) {
      accountDiagnostic(accountId, 'RELEASE complete → posting worker xác nhận Chrome đã đóng')
    } else {
      accountDiagnostic(
        accountId,
        `RELEASE warning → posting worker đã thoát${exitCode === null ? '' : ` code=${exitCode}`}; Chrome close không được xác nhận`
      )
    }
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

  private spawnWorker(job: FacebookPostTaskJobRequest): AccountWorkerEntry {
    const managedEndpoint = getManagedBrowserEndpoint(job.accountId, job.profileDirectory)
    const workerArgs = managedEndpoint ? [`${MANAGED_CDP_ARG_PREFIX}${managedEndpoint}`] : []
    const worker = utilityProcess.fork(join(__dirname, 'posting-worker.js'), workerArgs, {
      serviceName: `PAGE-AUTO posting account ${job.accountId}`
    })
    const entry: AccountWorkerEntry = {
      accountId: job.accountId,
      profileDirectory: job.profileDirectory,
      process: worker,
      ready: false,
      pending: null,
      shuttingDown: false,
      retainForManualSession: false
    }
    this.workers.set(job.accountId, entry)
    diagnostic(job, managedEndpoint ? 'spawn worker + attach Chrome managed' : 'spawn worker + sẽ mở persistent Chrome')

    worker.on('message', (raw: unknown) => {
      if (raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'email_code_request') {
        void this.handleEmailCodeRequest(entry, raw as EmailCodeWorkerRequestMessage)
        return
      }

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
        entry.retainForManualSession = shouldRetainPostingBrowserForManualSession(message.result)
        diagnostic(
          pending.job,
          `RESULT status=${message.result.status} code=${message.result.code ?? 'none'} — ${message.result.message}${entry.retainForManualSession ? ' [browser retained for manual session]' : ''}`
        )
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

  private async handleEmailCodeRequest(entry: AccountWorkerEntry, message: EmailCodeWorkerRequestMessage): Promise<void> {
    let result: EmailCodeResult
    if (message.request.accountId !== entry.accountId) {
      result = emailSupportError(entry.accountId, 'Email Support bridge từ chối yêu cầu sai account.')
    } else if (entry.shuttingDown) {
      result = emailSupportError(entry.accountId, 'Posting worker đang đóng; không thể lấy mã Email.')
    } else {
      const provider = getEmailCodeProvider()
      if (!provider) {
        result = emailSupportError(entry.accountId, 'Email Support Service chưa được khởi tạo ở Main process.')
      } else {
        try {
          result = await provider.getEmailCode({ ...message.request, accountId: entry.accountId })
        } catch {
          result = emailSupportError(entry.accountId, 'Email Support Service gặp lỗi khi xử lý yêu cầu.')
        }
      }
    }

    const response: EmailCodeWorkerResponseMessage = {
      type: 'email_code_response',
      requestId: message.requestId,
      result
    }
    try {
      entry.process.postMessage(response)
    } catch {
      // Worker exit/timeout path owns cleanup. Never log OTP contents here.
    }
  }

  private dispatch(entry: AccountWorkerEntry): void {
    const pending = entry.pending
    if (!entry.ready || !pending || pending.sent || entry.shuttingDown) return
    pending.sent = true
    const request: FacebookPostWorkerRequestMessage = { type: 'execute', job: pending.job }
    diagnostic(pending.job, `SEND execute → ${pending.job.task.type}`)
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
