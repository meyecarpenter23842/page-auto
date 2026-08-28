import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import { DEFAULT_APP_SETTINGS, type RuntimeSettings } from '../../shared/appSettings'
import type { ActionExecutionSummary, ActionLogEvent } from '../../shared/actionRuntime'
import type {
  ScenarioActionWorkerJob,
  ScenarioActionWorkerMessage,
  ScenarioActionWorkerResult
} from '../../shared/scenarioActionWorker'
import { getManagedBrowserEndpoint } from './managedBrowserRegistry'
import { BrowserLaunchGate } from './runtimeLaunchGate'

const MANAGED_CDP_ARG_PREFIX = '--page-auto-managed-cdp='
const SHUTDOWN_TIMEOUT_MS = 5_000

interface PendingAction {
  job: ScenarioActionWorkerJob
  runKey: string
  resolve: (result: ScenarioActionWorkerResult) => void
  onLog?: (event: ActionLogEvent) => void
  timer: NodeJS.Timeout
  sent: boolean
}

interface WorkerEntry {
  accountId: number
  process: UtilityProcess
  ready: boolean
  pending: PendingAction | null
  shuttingDown: boolean
}

function failedWorkerResult(job: ScenarioActionWorkerJob, code: string, message: string): ScenarioActionWorkerResult {
  const now = Date.now()
  const summary: ActionExecutionSummary = {
    result: { status: 'failed', code, message },
    normalizedConfig: null,
    attempts: 0,
    startedAt: now,
    finishedAt: now
  }
  return { summary, sessionCookie: null, accountName: null, sessionState: null }
}

function messagePayload(event: unknown): unknown {
  return event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event
}

function isWorkerMessage(event: unknown): event is ScenarioActionWorkerMessage {
  const value = messagePayload(event)
  if (!value || typeof value !== 'object') return false
  const type = (value as { type?: unknown }).type
  return type === 'ready' || type === 'log' || type === 'result'
}

export class ScenarioActionWorkerManager {
  private readonly workers = new Map<number, WorkerEntry>()
  private readonly launchGate = new BrowserLaunchGate()

  constructor(private readonly getRuntimeSettings: () => RuntimeSettings = () => ({ ...DEFAULT_APP_SETTINGS.runtime })) {}

  async run(job: ScenarioActionWorkerJob, onLog?: (event: ActionLogEvent) => void): Promise<ScenarioActionWorkerResult> {
    const runtime = { ...this.getRuntimeSettings() }
    let entry = this.workers.get(job.accountId)
    if (!entry || entry.shuttingDown) {
      await this.launchGate.wait(runtime.browserLaunchSpacingMs, 0)
      try {
        entry = this.spawn(job)
      } catch (error) {
        return failedWorkerResult(job, 'browser_unavailable', error instanceof Error ? error.message : String(error))
      }
    }
    if (entry.pending) return failedWorkerResult(job, 'browser_unavailable', `Action worker account #${job.accountId} đang bận.`)

    return new Promise<ScenarioActionWorkerResult>((resolve) => {
      const timeoutMs = Math.max(60_000, runtime.maxAccountRuntimeSeconds * 1000)
      const timer = setTimeout(() => {
        if (!entry?.pending || entry.pending.runKey !== job.request.runKey) return
        const pending = entry.pending
        entry.pending = null
        entry.shuttingDown = true
        this.workers.delete(job.accountId)
        entry.process.kill()
        pending.resolve(failedWorkerResult(job, 'network_timeout', 'Action worker vượt giới hạn runtime cho phép.'))
      }, timeoutMs)
      entry.pending = { job, runKey: job.request.runKey, resolve, ...(onLog ? { onLog } : {}), timer, sent: false }
      this.dispatch(entry, job)
    })
  }

  stop(accountId: number, runKey: string): void {
    const entry = this.workers.get(accountId)
    if (!entry || entry.shuttingDown) return
    try { entry.process.postMessage({ type: 'stop', runKey }) } catch { /* exit handler settles */ }
  }

  async closeAccount(accountId: number): Promise<void> {
    const entry = this.workers.get(accountId)
    if (!entry) return
    if (entry.pending) throw new Error(`Không thể đóng action worker account #${accountId} khi action đang chạy.`)
    if (entry.shuttingDown) return
    entry.shuttingDown = true
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        if (this.workers.get(accountId) === entry) this.workers.delete(accountId)
        resolve()
      }
      entry.process.once('exit', finish)
      const timer = setTimeout(() => {
        try { entry.process.kill() } finally { finish() }
      }, SHUTDOWN_TIMEOUT_MS)
      entry.process.once('exit', () => clearTimeout(timer))
      try { entry.process.postMessage({ type: 'shutdown' }) } catch { entry.process.kill() }
    })
  }

  closeAll(): void {
    for (const entry of this.workers.values()) {
      entry.shuttingDown = true
      entry.process.kill()
    }
    this.workers.clear()
  }

  private spawn(job: ScenarioActionWorkerJob): WorkerEntry {
    const managedEndpoint = getManagedBrowserEndpoint(job.accountId)
    const args = managedEndpoint ? [`${MANAGED_CDP_ARG_PREFIX}${managedEndpoint}`] : []
    const process = utilityProcess.fork(join(__dirname, 'scenario-action-worker.js'), args, {
      serviceName: `PAGE-AUTO scenario action account ${job.accountId}`
    })
    const entry: WorkerEntry = { accountId: job.accountId, process, ready: false, pending: null, shuttingDown: false }
    this.workers.set(job.accountId, entry)
    process.on('message', (message) => this.handleMessage(entry, message))
    process.once('exit', (code) => {
      entry.shuttingDown = true
      const pending = entry.pending
      entry.pending = null
      if (pending) {
        clearTimeout(pending.timer)
        pending.resolve(failedWorkerResult(pending.job, 'browser_unavailable', `Action worker đã thoát (code ${code}).`))
      }
      if (this.workers.get(job.accountId) === entry) this.workers.delete(job.accountId)
    })
    return entry
  }

  private dispatch(entry: WorkerEntry, job: ScenarioActionWorkerJob): void {
    const pending = entry.pending
    if (!pending || pending.sent || !entry.ready || entry.shuttingDown) return
    pending.sent = true
    try { entry.process.postMessage({ type: 'execute', job }) } catch (error) {
      clearTimeout(pending.timer)
      entry.pending = null
      pending.resolve(failedWorkerResult(job, 'browser_unavailable', error instanceof Error ? error.message : String(error)))
    }
  }

  private handleMessage(entry: WorkerEntry, event: unknown): void {
    const payload = messagePayload(event)
    if (!isWorkerMessage(payload)) return
    if (payload.type === 'ready') {
      entry.ready = true
      if (entry.pending) this.dispatch(entry, entry.pending.job)
      return
    }
    if (payload.type === 'log') {
      entry.pending?.onLog?.(payload.event)
      return
    }
    const pending = entry.pending
    if (!pending || pending.runKey !== payload.runKey) return
    clearTimeout(pending.timer)
    entry.pending = null
    pending.resolve(payload.result)
  }
}
