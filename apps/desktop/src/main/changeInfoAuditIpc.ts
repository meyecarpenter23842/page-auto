import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { join } from 'node:path'
import type { ActionRunRequest } from '../shared/actionRuntime'
import {
  CHANGE_INFO_AUDIT_IPC,
  type ChangeInfoBioAuditPayload,
  type ChangeInfoBioAuditResult
} from '../shared/changeInfoAudit'
import { ChangeInfoAuditWorkerManager } from './browser/changeInfoAuditWorkerManager'
import { AccountRepository } from './database/accountRepository'
import { AppSettingsRepository } from './database/appSettingsRepository'
import {
  FacebookCommonSessionPolicy,
  scenarioActionJobForCommonSessionPolicy
} from './facebook/facebookSessionPolicy'
import { AccountExecutionCoordinator } from './services/accountExecutionCoordinator'

export interface ChangeInfoAuditIpcRuntime { dispose: () => void }

interface ChangeInfoAuditIpcOptions {
  database: Database.Database
  dataDirectory: string
}

function failed(accountId: number, uid: string, code: string, message: string): ChangeInfoBioAuditResult {
  return { status: 'failed', accountId, uid, code, message }
}

export function registerChangeInfoAuditIpcHandlers(options: ChangeInfoAuditIpcOptions): ChangeInfoAuditIpcRuntime {
  const accounts = new AccountRepository(options.database)
  const appSettings = new AppSettingsRepository(options.database)
  const sessionPolicy = new FacebookCommonSessionPolicy(options.database, options.dataDirectory)
  const accountExecution = new AccountExecutionCoordinator()
  const worker = new ChangeInfoAuditWorkerManager(() => appSettings.get().runtime)
  const evidenceFolder = join(options.dataDirectory, 'screenshots', 'change-info-audit')

  ipcMain.handle(CHANGE_INFO_AUDIT_IPC.bio, async (_event, payload: ChangeInfoBioAuditPayload) => {
    const account = accounts.getById(payload.accountId)
    if (!account) return failed(payload.accountId, '', 'account_not_found', 'Không tìm thấy account để audit Tiểu sử.')

    return accountExecution.run(account.id, async () => {
      try {
        const settings = appSettings.get()
        const request: ActionRunRequest = {
          runKey: `change-info-audit-bio-${account.id}-${Date.now()}`,
          actionType: '__change_info_audit_bio__',
          label: 'Audit live Tiểu sử',
          actor: { kind: 'profile', accountId: account.id, accountUid: account.uid },
          config: {},
          retry: { maxAttempts: 1, delayMs: 0, retryableCodes: [] }
        }
        const baseJob = scenarioActionJobForCommonSessionPolicy(account, request, settings)
        const hydrated = sessionPolicy.hydrateScenarioActionJob(baseJob)
        return await worker.run(hydrated, evidenceFolder)
      } catch (error) {
        return failed(
          account.id,
          account.uid,
          'audit_prepare_failed',
          error instanceof Error ? error.message : String(error)
        )
      }
    })
  })

  return {
    dispose: () => {
      ipcMain.removeHandler(CHANGE_INFO_AUDIT_IPC.bio)
    }
  }
}
