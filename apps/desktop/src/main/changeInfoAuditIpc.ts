import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { join } from 'node:path'
import type { AppSettings } from '../shared/appSettings'
import type { ActionLogEvent, ActionRunRequest } from '../shared/actionRuntime'
import {
  CHANGE_INFO_AUDIT_IPC,
  type ChangeInfoBioAuditPayload,
  type ChangeInfoBioAuditResult
} from '../shared/changeInfoAudit'
import {
  CHANGE_INFO_RUNNER_IPC,
  type ChangeInfoWorkspaceRunPayload
} from '../shared/changeInfoRunner'
import type { ScenarioActionWorkerJob, ScenarioActionWorkerResult } from '../shared/scenarioActionWorker'
import { BrowserWindowLayoutManager } from './browser/browserWindowLayoutManager'
import { ChangeInfoAuditWorkerManager } from './browser/changeInfoAuditWorkerManager'
import { AccountRepository } from './database/accountRepository'
import { AppSettingsRepository } from './database/appSettingsRepository'
import { BrowserWindowLayoutRepository } from './database/browserWindowLayoutRepository'
import {
  FacebookCommonSessionPolicy,
  FacebookSessionPolicyWorkerManager,
  scenarioActionJobForCommonSessionPolicy
} from './facebook/facebookSessionPolicy'
import { AccountExecutionCoordinator } from './services/accountExecutionCoordinator'
import { ChangeInfoWorkspaceRunnerService } from './services/changeInfoWorkspaceRunnerService'

export interface ChangeInfoAuditIpcRuntime { dispose: () => void }

interface ChangeInfoAuditIpcOptions {
  database: Database.Database
  dataDirectory: string
}

/**
 * Change Info runs through the same global browser-slot/layout contract as other
 * Scenario/Workspace automation. The worker still owns browser lifecycle; this host
 * only claims/releases the desktop slot and injects the computed placement into the job.
 */
class ChangeInfoLayoutAwareWorkerManager extends FacebookSessionPolicyWorkerManager {
  private readonly browserWindowLayout = new BrowserWindowLayoutManager()
  private readonly browserWindowLayoutSettings: BrowserWindowLayoutRepository
  private readonly claimedAccounts = new Set<number>()

  constructor(
    database: Database.Database,
    dataDirectory: string,
    private readonly getSettings: () => AppSettings
  ) {
    super(database, dataDirectory, () => getSettings().runtime)
    this.browserWindowLayoutSettings = new BrowserWindowLayoutRepository(database)
  }

  override async run(
    job: ScenarioActionWorkerJob,
    onLog?: (event: ActionLogEvent) => void
  ): Promise<ScenarioActionWorkerResult> {
    const settings = this.getSettings()
    this.browserWindowLayout.claim(job.accountId, 'scenario')
    this.claimedAccounts.add(job.accountId)
    const browserPlacement = this.browserWindowLayout.placementFor(
      job.accountId,
      this.browserWindowLayoutSettings.get(),
      settings.browser
    )
    return super.run(
      browserPlacement ? { ...job, browserPlacement } : job,
      onLog
    )
  }

  override async closeAccount(accountId: number): Promise<void> {
    try {
      await super.closeAccount(accountId)
    } finally {
      this.browserWindowLayout.release(accountId, 'scenario')
      this.claimedAccounts.delete(accountId)
    }
  }

  override closeAll(): void {
    super.closeAll()
    for (const accountId of this.claimedAccounts) {
      this.browserWindowLayout.release(accountId, 'scenario')
    }
    this.claimedAccounts.clear()
  }
}

function failed(accountId: number, uid: string, code: string, message: string): ChangeInfoBioAuditResult {
  return { status: 'failed', accountId, uid, code, message }
}

export function registerChangeInfoAuditIpcHandlers(options: ChangeInfoAuditIpcOptions): ChangeInfoAuditIpcRuntime {
  const accounts = new AccountRepository(options.database)
  const appSettings = new AppSettingsRepository(options.database)
  const sessionPolicy = new FacebookCommonSessionPolicy(options.database, options.dataDirectory)
  const accountExecution = new AccountExecutionCoordinator()
  const auditWorker = new ChangeInfoAuditWorkerManager(() => appSettings.get().runtime)
  const browserWindowLayout = new BrowserWindowLayoutManager()
  const browserWindowLayoutSettings = new BrowserWindowLayoutRepository(options.database)
  const mutationWorkers = new ChangeInfoLayoutAwareWorkerManager(
    options.database,
    options.dataDirectory,
    () => appSettings.get()
  )
  const runner = new ChangeInfoWorkspaceRunnerService(
    options.database,
    mutationWorkers,
    accountExecution,
    () => appSettings.get()
  )
  const evidenceFolder = join(options.dataDirectory, 'screenshots', 'change-info-audit')

  ipcMain.handle(CHANGE_INFO_AUDIT_IPC.bio, async (_event, payload: ChangeInfoBioAuditPayload) => {
    const account = accounts.getById(payload.accountId)
    if (!account) return failed(payload.accountId, '', 'account_not_found', 'Không tìm thấy account để audit Tiểu sử.')

    return accountExecution.run(account.id, async () => {
      browserWindowLayout.claim(account.id, 'scenario')
      try {
        const settings = appSettings.get()
        const browserPlacement = browserWindowLayout.placementFor(
          account.id,
          browserWindowLayoutSettings.get(),
          settings.browser
        )
        const request: ActionRunRequest = {
          runKey: `change-info-audit-bio-${account.id}-${Date.now()}`,
          actionType: '__change_info_audit_bio__',
          label: 'Audit live Tiểu sử',
          actor: { kind: 'profile', accountId: account.id, accountUid: account.uid },
          config: {},
          retry: { maxAttempts: 1, delayMs: 0, retryableCodes: [] }
        }
        const baseJob = scenarioActionJobForCommonSessionPolicy(account, request, settings, browserPlacement)
        const hydrated = sessionPolicy.hydrateScenarioActionJob(baseJob)
        return await auditWorker.run(hydrated, evidenceFolder)
      } catch (error) {
        return failed(account.id, account.uid, 'audit_prepare_failed', error instanceof Error ? error.message : String(error))
      } finally {
        browserWindowLayout.release(account.id, 'scenario')
      }
    })
  })

  ipcMain.handle(CHANGE_INFO_RUNNER_IPC.start, (_event, payload: ChangeInfoWorkspaceRunPayload) => runner.start(payload.workspaceId))
  ipcMain.handle(CHANGE_INFO_RUNNER_IPC.status, (_event, payload: ChangeInfoWorkspaceRunPayload) => runner.status(payload.workspaceId))
  ipcMain.handle(CHANGE_INFO_RUNNER_IPC.pause, (_event, payload: ChangeInfoWorkspaceRunPayload) => runner.pause(payload.workspaceId))
  ipcMain.handle(CHANGE_INFO_RUNNER_IPC.resume, (_event, payload: ChangeInfoWorkspaceRunPayload) => runner.resume(payload.workspaceId))
  ipcMain.handle(CHANGE_INFO_RUNNER_IPC.stop, (_event, payload: ChangeInfoWorkspaceRunPayload) => runner.stop(payload.workspaceId))

  return {
    dispose: () => {
      runner.dispose()
      ipcMain.removeHandler(CHANGE_INFO_AUDIT_IPC.bio)
      for (const channel of Object.values(CHANGE_INFO_RUNNER_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
