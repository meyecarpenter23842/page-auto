import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { RuntimeSettings } from '../../shared/appSettings'
import type { ChangeInfoBioAuditResult } from '../../shared/changeInfoAudit'
import type { ScenarioActionWorkerJob } from '../../shared/scenarioActionWorker'
import { configureGlobalBrowserLaunchBroker, setBrowserLaunchAwareTimeout } from './browserLaunchBroker'
import { facebookLaunchFingerprint } from './facebookLaunchFingerprint'
import { getManagedBrowserEndpoint } from './managedBrowserRegistry'

const MANAGED_CDP_ARG_PREFIX = '--page-auto-managed-cdp='
const SHUTDOWN_GRACE_MS = 5_000

interface AuditReadyMessage {
  type: 'ready'
}

interface AuditResultMessage {
  type: 'result'
  result: ChangeInfoBioAuditResult
}

function messagePayload(event: unknown): unknown {
  return event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event
}

function isAuditReadyMessage(event: unknown): event is AuditReadyMessage {
  const payload = messagePayload(event)
  return Boolean(payload && typeof payload === 'object' && (payload as { type?: unknown }).type === 'ready')
}

function isAuditResultMessage(event: unknown): event is AuditResultMessage {
  const payload = messagePayload(event)
  return Boolean(
    payload
      && typeof payload === 'object'
      && (payload as { type?: unknown }).type === 'result'
      && (payload as { result?: unknown }).result
  )
}

function failed(job: ScenarioActionWorkerJob, code: string, message: string): ChangeInfoBioAuditResult {
  return {
    status: 'failed',
    accountId: job.accountId,
    uid: job.sessionAccount.uid,
    code,
    message
  }
}

export class ChangeInfoAuditWorkerManager {
  constructor(private readonly getRuntimeSettings: () => RuntimeSettings) {
    configureGlobalBrowserLaunchBroker(getRuntimeSettings)
  }

  run(job: ScenarioActionWorkerJob, evidenceFolder: string): Promise<ChangeInfoBioAuditResult> {
    const fingerprint = facebookLaunchFingerprint(job)
    const managedEndpoint = getManagedBrowserEndpoint(job.accountId, job.profileDirectory, fingerprint)
    const args = managedEndpoint ? [`${MANAGED_CDP_ARG_PREFIX}${managedEndpoint}`] : []
    const worker = utilityProcess.fork(join(__dirname, 'change-info-audit-worker.js'), args, {
      serviceName: `PAGE-AUTO Change Info audit account ${job.accountId}`
    })

    return new Promise<ChangeInfoBioAuditResult>((resolve) => {
      let settled = false
      let sent = false
      let shutdownTimer: NodeJS.Timeout | null = null

      const finish = (result: ChangeInfoBioAuditResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (shutdownTimer) clearTimeout(shutdownTimer)
        resolve(result)
      }

      const timeoutMs = Math.max(90_000, this.getRuntimeSettings().maxAccountRuntimeSeconds * 1000)
      const timeout = setBrowserLaunchAwareTimeout(worker, () => {
        if (settled) return
        try { worker.postMessage({ type: 'shutdown' }) } catch { /* exit path below settles */ }
        shutdownTimer = setTimeout(() => {
          try { worker.kill() } catch { /* already exited */ }
        }, SHUTDOWN_GRACE_MS)
        finish(failed(job, 'audit_timeout', 'Audit live Tiểu sử vượt quá thời gian cho phép.'))
      }, timeoutMs)

      worker.on('message', (event) => {
        if (isAuditReadyMessage(event) && !sent) {
          sent = true
          try {
            worker.postMessage({ type: 'audit-bio', job, evidenceFolder })
          } catch (error) {
            finish(failed(job, 'audit_dispatch_failed', error instanceof Error ? error.message : String(error)))
          }
          return
        }
        if (!isAuditResultMessage(event)) return
        finish(messagePayload(event) && (messagePayload(event) as AuditResultMessage).result)
      })

      worker.once('exit', (code) => {
        if (settled) return
        finish(failed(job, 'audit_worker_exited', `Change Info audit worker đã thoát trước khi trả evidence (code ${code}).`))
      })
    })
  }
}
