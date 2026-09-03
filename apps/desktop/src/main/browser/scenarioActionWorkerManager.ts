import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import { DEFAULT_APP_SETTINGS, type RuntimeSettings } from '../../shared/appSettings'
import type { ActionExecutionSummary, ActionLogEvent } from '../../shared/actionRuntime'
import type { ScenarioActionWorkerJob, ScenarioActionWorkerMessage, ScenarioActionWorkerResult } from '../../shared/scenarioActionWorker'
import { configureGlobalBrowserLaunchBroker, setBrowserLaunchAwareTimeout } from './browserLaunchBroker'
import { facebookLaunchFingerprint, facebookLaunchReuseDecision } from './facebookLaunchFingerprint'
import { getManagedBrowserEndpoint } from './managedBrowserRegistry'

const MANAGED_CDP_ARG_PREFIX = '--page-auto-managed-cdp='
const SHUTDOWN_TIMEOUT_MS = 5_000

interface PendingAction {
  job: ScenarioActionWorkerJob
  runKey: string
  resolve: (result: ScenarioActionWorkerResult) => void
  onLog?: (event: ActionLogEvent) => void
  timer: NodeJS.Timeout | null
  timeoutStartedAt: number
  remainingTimeoutMs: number
  sent: boolean
}
interface WorkerEntry {
  accountId: number
  profileDirectory: string
  launchFingerprint: string
  process: UtilityProcess
  ready: boolean
  pending: PendingAction | null
  shuttingDown: boolean
}

export interface ScenarioActionSpecialHandler {
  handles(actionType: string): boolean
  run(job: ScenarioActionWorkerJob, onLog?: (event: ActionLogEvent) => void): Promise<ScenarioActionWorkerResult>
  pause?(accountId: number, runKey: string): void
  resume?(accountId: number, runKey: string): void
  stop?(accountId: number, runKey: string): void
  closeAccount?(accountId: number): Promise<void>
  closeAll?(): void
}

function failedWorkerResult(job: ScenarioActionWorkerJob, code: string, message: string): ScenarioActionWorkerResult {
  const now = Date.now()
  const summary: ActionExecutionSummary = { result: { status: 'failed', code, message }, normalizedConfig: null, attempts: 0, startedAt: now, finishedAt: now }
  return { summary, sessionCookie: null, accountName: null, sessionState: null }
}
function messagePayload(event: unknown): unknown { return event && typeof event === 'object' && 'data' in event ? (event as { data?: unknown }).data : event }
function isWorkerMessage(event: unknown): event is ScenarioActionWorkerMessage {
  const value = messagePayload(event)
  if (!value || typeof value !== 'object') return false
  const type = (value as { type?: unknown }).type
  return type === 'ready' || type === 'log' || type === 'result'
}

export class ScenarioActionWorkerManager {
  private readonly workers = new Map<number, WorkerEntry>()
  constructor(
    private readonly getRuntimeSettings: () => RuntimeSettings = () => ({ ...DEFAULT_APP_SETTINGS.runtime }),
    private readonly specialHandler?: ScenarioActionSpecialHandler
  ) {
    configureGlobalBrowserLaunchBroker(this.getRuntimeSettings)
  }

  async run(job: ScenarioActionWorkerJob, onLog?: (event: ActionLogEvent) => void): Promise<ScenarioActionWorkerResult> {
    if (this.specialHandler?.handles(job.request.actionType)) {
      await this.closeWorkerProcess(job.accountId)
      return this.specialHandler.run(job, onLog)
    }

    await this.specialHandler?.closeAccount?.(job.accountId)

    const runtime = { ...this.getRuntimeSettings() }
    const launchFingerprint = facebookLaunchFingerprint(job)
    let entry = this.workers.get(job.accountId)

    if (entry && !entry.shuttingDown) {
      const launchDecision = facebookLaunchReuseDecision(
        entry.launchFingerprint,
        launchFingerprint,
        Boolean(entry.pending)
      )
      if (launchDecision === 'busy') {
        return failedWorkerResult(
          job,
          'browser_unavailable',
          `Profile/proxy/UserAgent canonical vừa thay đổi nhưng action worker account #${job.accountId} đang bận. Hãy dừng action hiện tại rồi chạy lại.`
        )
      }
      if (launchDecision === 'replace') {
        await this.closeWorkerProcess(job.accountId)
        entry = undefined
      }
    }

    if (!entry || entry.shuttingDown) {
      try { entry = this.spawn(job, launchFingerprint) } catch (error) { return failedWorkerResult(job, 'browser_unavailable', error instanceof Error ? error.message : String(error)) }
    }
    if (entry.pending) return failedWorkerResult(job, 'browser_unavailable', `Action worker account #${job.accountId} đang bận.`)
    return new Promise<ScenarioActionWorkerResult>((resolve) => {
      const timeoutMs = Math.max(60_000, runtime.maxAccountRuntimeSeconds * 1000)
      entry.pending = {
        job,
        runKey: job.request.runKey,
        resolve,
        ...(onLog ? { onLog } : {}),
        timer: null,
        timeoutStartedAt: 0,
        remainingTimeoutMs: timeoutMs,
        sent: false
      }
      this.armTimeout(entry)
      this.dispatch(entry, job)
    })
  }

  pause(accountId: number, runKey: string): void {
    this.specialHandler?.pause?.(accountId, runKey)
    const entry = this.workers.get(accountId)
    if (!entry || entry.shuttingDown || entry.pending?.runKey !== runKey) return
    this.pauseTimeout(entry.pending)
    try { entry.process.postMessage({ type: 'pause', runKey }) } catch { /* worker exit settles pending */ }
  }

  resume(accountId: number, runKey: string): void {
    this.specialHandler?.resume?.(accountId, runKey)
    const entry = this.workers.get(accountId)
    if (!entry || entry.shuttingDown || entry.pending?.runKey !== runKey) return
    this.armTimeout(entry)
    try { entry.process.postMessage({ type: 'resume', runKey }) } catch { /* worker exit settles pending */ }
  }

  stop(accountId: number, runKey: string): void {
    this.specialHandler?.stop?.(accountId, runKey)
    const specialClose = this.specialHandler?.closeAccount?.(accountId)
    if (specialClose) void specialClose.catch(() => undefined)
    const entry = this.workers.get(accountId)
    if (!entry || entry.shuttingDown) return
    try { entry.process.postMessage({ type: 'stop', runKey }) } catch { /* exit handler settles */ }
  }

  async closeAccount(accountId: number): Promise<void> {
    await this.specialHandler?.closeAccount?.(accountId)
    await this.closeWorkerProcess(accountId)
  }

  closeAll(): void {
    this.specialHandler?.closeAll?.()
    for (const entry of this.workers.values()) { entry.shuttingDown = true; entry.process.kill() }
    this.workers.clear()
  }

  private async closeWorkerProcess(accountId: number): Promise<void> {
    const entry = this.workers.get(accountId)
    if (!entry) return
    if (entry.pending) throw new Error(`Không thể đóng action worker account #${accountId} khi action đang chạy.`)
    if (entry.shuttingDown) return
    entry.shuttingDown = true
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => { if (settled) return; settled = true; if (this.workers.get(accountId) === entry) this.workers.delete(accountId); resolve() }
      entry.process.once('exit', finish)
      const timer = setTimeout(() => { try { entry.process.kill() } finally { finish() } }, SHUTDOWN_TIMEOUT_MS)
      entry.process.once('exit', () => clearTimeout(timer))
      try { entry.process.postMessage({ type: 'shutdown' }) } catch { entry.process.kill() }
    })
  }

  private spawn(job: ScenarioActionWorkerJob, launchFingerprint: string): WorkerEntry {
    const managedEndpoint = getManagedBrowserEndpoint(job.accountId, job.profileDirectory, launchFingerprint)
    const args = managedEndpoint ? [`${MANAGED_CDP_ARG_PREFIX}${managedEndpoint}`] : []
    const process = utilityProcess.fork(join(__dirname, 'scenario-action-worker.js'), args, { serviceName: `PAGE-AUTO scenario action account ${job.accountId}` })
    const entry: WorkerEntry = {
      accountId: job.accountId,
      profileDirectory: job.profileDirectory,
      launchFingerprint,
      process,
      ready: false,
      pending: null,
      shuttingDown: false
    }
    this.workers.set(job.accountId, entry)
    process.on('message', (message) => this.handleMessage(entry, message))
    process.once('exit', (code) => {
      entry.shuttingDown = true
      const pending = entry.pending
      entry.pending = null
      if (pending) { if (pending.timer) clearTimeout(pending.timer); pending.resolve(failedWorkerResult(pending.job, 'browser_unavailable', `Action worker đã thoát (code ${code}).`)) }
      if (this.workers.get(job.accountId) === entry) this.workers.delete(job.accountId)
    })
    return entry
  }

  private dispatch(entry: WorkerEntry, job: ScenarioActionWorkerJob): void {
    const pending = entry.pending
    if (!pending || pending.sent || !entry.ready || entry.shuttingDown) return
    pending.sent = true
    try { entry.process.postMessage({ type: 'execute', job }) } catch (error) {
      if (pending.timer) clearTimeout(pending.timer); entry.pending = null; pending.resolve(failedWorkerResult(job, 'browser_unavailable', error instanceof Error ? error.message : String(error)))
    }
  }

  private handleMessage(entry: WorkerEntry, event: unknown): void {
    const payload = messagePayload(event)
    if (!isWorkerMessage(payload)) return
    if (payload.type === 'ready') { entry.ready = true; if (entry.pending) this.dispatch(entry, entry.pending.job); return }
    if (payload.type === 'log') { entry.pending?.onLog?.(payload.event); return }
    const pending = entry.pending
    if (!pending || pending.runKey !== payload.runKey) return
    if (pending.timer) clearTimeout(pending.timer)
    entry.pending = null
    pending.resolve(payload.result)
  }

  private pauseTimeout(pending: PendingAction): void {
    if (!pending.timer) return
    clearTimeout(pending.timer)
    pending.timer = null
    const elapsed = Math.max(0, Date.now() - pending.timeoutStartedAt)
    pending.remainingTimeoutMs = Math.max(1, pending.remainingTimeoutMs - elapsed)
  }

  private armTimeout(entry: WorkerEntry): void {
    const pending = entry.pending
    if (!pending || pending.timer || entry.shuttingDown) return
    pending.timeoutStartedAt = Date.now()
    pending.timer = setBrowserLaunchAwareTimeout(entry.process, () => {
      if (!entry.pending || entry.pending !== pending || entry.pending.runKey !== pending.runKey) return
      entry.pending = null
      entry.shuttingDown = true
      this.workers.delete(entry.accountId)
      entry.process.kill()
      pending.resolve(failedWorkerResult(pending.job, 'network_timeout', 'Action worker vượt giới hạn runtime cho phép.'))
    }, pending.remainingTimeoutMs)
  }
}
