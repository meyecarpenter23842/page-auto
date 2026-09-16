import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { RuntimeSettings } from '../../../shared/appSettings'
import { configureGlobalBrowserLaunchBroker } from '../../browser/browserLaunchBroker'
import { facebookLaunchFingerprint } from '../../browser/facebookLaunchFingerprint'
import { getManagedBrowserEndpoint } from '../../browser/managedBrowserRegistry'
import {
  ScanAdapterRuntimeError,
  type ScanAdapterControl,
  type ScanControlState
} from '../scanAdapter'
import type { UserScanRawRecord } from './userScanAdapter'
import type {
  UserScanWorkerEvent,
  UserScanWorkerJob,
  UserScanWorkerSessionUpdate
} from './userScanWorkerContracts'

const MANAGED_CDP_ARG_PREFIX = '--page-auto-managed-cdp='
const WORKER_SHUTDOWN_TIMEOUT_MS = 5_000

function messagePayload(event: unknown): unknown {
  return event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event
}

function isWorkerEvent(event: unknown): event is UserScanWorkerEvent {
  const value = messagePayload(event)
  if (!value || typeof value !== 'object') return false
  const type = (value as { type?: unknown }).type
  return type === 'ready' || type === 'record' || type === 'complete' || type === 'terminal'
}

class AsyncRecordQueue implements AsyncIterator<UserScanRawRecord>, AsyncIterable<UserScanRawRecord> {
  private readonly values: UserScanRawRecord[] = []
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<UserScanRawRecord>) => void
    reject: (error: Error) => void
  }> = []
  private ended = false
  private failure: Error | null = null

  push(value: UserScanRawRecord): void {
    if (this.ended || this.failure) return
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve({ done: false, value })
    else this.values.push(value)
  }

  end(): void {
    if (this.ended || this.failure) return
    this.ended = true
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ done: true, value: undefined })
  }

  fail(error: Error): void {
    if (this.ended || this.failure) return
    this.failure = error
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
  }

  next(): Promise<IteratorResult<UserScanRawRecord>> {
    if (this.values.length) return Promise.resolve({ done: false, value: this.values.shift()! })
    if (this.failure) return Promise.reject(this.failure)
    if (this.ended) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
  }

  [Symbol.asyncIterator](): AsyncIterator<UserScanRawRecord> { return this }
}

export class UserScanWorkerManager {
  private readonly active = new Set<UtilityProcess>()

  constructor(
    private readonly getRuntimeSettings: () => RuntimeSettings,
    private readonly onSessionUpdate?: (accountId: number, update: UserScanWorkerSessionUpdate) => void
  ) {
    configureGlobalBrowserLaunchBroker(this.getRuntimeSettings)
  }

  async *run(job: UserScanWorkerJob, control: ScanAdapterControl): AsyncIterable<UserScanRawRecord> {
    const fingerprint = facebookLaunchFingerprint(job)
    const managedEndpoint = getManagedBrowserEndpoint(job.accountId, job.profileDirectory, fingerprint)
    const args = managedEndpoint ? [`${MANAGED_CDP_ARG_PREFIX}${managedEndpoint}`] : []
    const worker = utilityProcess.fork(join(__dirname, 'scanner-user-worker.js'), args, {
      serviceName: `PAGE-AUTO scanner user account ${job.accountId}`
    })
    this.active.add(worker)

    const queue = new AsyncRecordQueue()
    let ready = false
    let started = false
    let terminal = false
    let shutdownTimer: NodeJS.Timeout | null = null

    const send = (message: unknown): void => {
      try { worker.postMessage(message) } catch { /* exit handler settles queue */ }
    }
    const startIfReady = (): void => {
      if (!ready || started || terminal) return
      started = true
      send({ type: 'start', job })
      if (control.isPaused()) send({ type: 'pause', runKey: job.runKey })
      if (control.isStopped()) send({ type: 'stop', runKey: job.runKey })
    }
    const requestShutdown = (): void => {
      if (shutdownTimer) return
      send({ type: 'shutdown' })
      shutdownTimer = setTimeout(() => {
        try { worker.kill() } catch { /* already gone */ }
      }, WORKER_SHUTDOWN_TIMEOUT_MS)
    }

    const stateListener = (state: ScanControlState): void => {
      if (!started || terminal) return
      if (state === 'paused') send({ type: 'pause', runKey: job.runKey })
      else if (state === 'running') send({ type: 'resume', runKey: job.runKey })
      else send({ type: 'stop', runKey: job.runKey })
    }
    const unsubscribe = control.onStateChange(stateListener)

    worker.on('message', (raw) => {
      const event = messagePayload(raw)
      if (!isWorkerEvent(event)) return
      if (event.type === 'ready') {
        ready = true
        startIfReady()
        return
      }
      if ('runKey' in event && event.runKey !== job.runKey) return
      if (event.type === 'record') {
        queue.push(event.record)
        return
      }
      terminal = true
      this.onSessionUpdate?.(job.accountId, {
        sessionCookie: event.sessionCookie,
        accountName: event.accountName,
        accountStatus: event.accountStatus
      })
      if (event.type === 'terminal') queue.fail(new ScanAdapterRuntimeError(event.status, event.message))
      else queue.end()
      requestShutdown()
    })

    worker.once('exit', (code) => {
      this.active.delete(worker)
      if (shutdownTimer) clearTimeout(shutdownTimer)
      if (!terminal) {
        terminal = true
        if (control.isStopped()) queue.end()
        else queue.fail(new ScanAdapterRuntimeError('failed', `User scanner worker đã thoát ngoài dự kiến (code ${code}).`))
      }
    })

    startIfReady()
    try {
      for await (const record of queue) {
        if (control.isStopped()) break
        yield record
      }
    } finally {
      unsubscribe()
      if (!terminal) {
        if (!control.isStopped()) send({ type: 'stop', runKey: job.runKey })
        requestShutdown()
      }
    }
  }

  closeAll(): void {
    for (const worker of this.active) {
      try { worker.postMessage({ type: 'shutdown' }) } catch { /* force kill below */ }
      setTimeout(() => {
        try { worker.kill() } catch { /* already gone */ }
      }, WORKER_SHUTDOWN_TIMEOUT_MS)
    }
    this.active.clear()
  }
}
