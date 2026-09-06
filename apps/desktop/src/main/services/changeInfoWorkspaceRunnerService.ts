import { readFile } from 'node:fs/promises'
import type Database from 'better-sqlite3'
import type { AccountRecord } from '../../shared/accounts'
import type { AppSettings } from '../../shared/appSettings'
import { ACTION_VERIFICATION_UNCERTAIN_CODE, type ActionLogEvent, type ActionRunRequest } from '../../shared/actionRuntime'
import type {
  ChangeInfoAccountRunRuntime,
  ChangeInfoActionRunResult,
  ChangeInfoRunLogEntry,
  ChangeInfoRunSnapshot
} from '../../shared/changeInfoRunner'
import {
  enabledChangeInfoCatalogItems,
  parseChangeInfoWorkspaceDraft,
  resolveChangeInfoDataSource,
  validateChangeInfoWorkspaceDraft,
  type ChangeInfoCatalogItem,
  type ChangeInfoDataScalar,
  type ChangeInfoDataSourceConfig
} from '../../shared/changeInfoWorkspace'
import type { ScenarioActionWorkerResult } from '../../shared/scenarioActionWorker'
import { ScenarioActionWorkerManager } from '../browser/scenarioActionWorkerManager'
import { AccountRepository } from '../database/accountRepository'
import { ActionWorkspaceRepository } from '../database/actionWorkspaceRepository'
import { scenarioActionJobForCommonSessionPolicy } from '../facebook/facebookSessionPolicy'
import { AccountExecutionCoordinator } from './accountExecutionCoordinator'
import { redactExecutionText } from './executionLogSanitizer'
import { runRollingAccountPool } from './rollingAccountPool'

interface OperationSnapshot {
  catalog: ChangeInfoCatalogItem
  source: ChangeInfoDataSourceConfig
  snapshotValues?: readonly ChangeInfoDataScalar[]
}

interface ActiveChangeInfoRun {
  snapshot: ChangeInfoRunSnapshot
  stopRequested: boolean
  runningKeys: Map<number, string>
  operations: OperationSnapshot[]
}

function cloneSnapshot(snapshot: ChangeInfoRunSnapshot): ChangeInfoRunSnapshot {
  return {
    ...snapshot,
    accounts: snapshot.accounts.map((account) => ({
      ...account,
      results: account.results.map((result) => ({ ...result }))
    })),
    logs: snapshot.logs.map((entry) => ({ ...entry }))
  }
}

function accountSecrets(account: AccountRecord): Array<string | null | undefined> {
  return [account.password, account.cookie, account.twoFactorSecret, account.emailPassword, account.proxy, account.proxyPassword]
}

function safeText(account: AccountRecord | null, message: string): string {
  return redactExecutionText(message, account ? accountSecrets(account) : []) ?? 'Runtime event.'
}

function actionResult(
  operation: OperationSnapshot,
  status: ChangeInfoActionRunResult['status'],
  code: string | null,
  message: string | null,
  startedAt: number,
  finishedAt = Date.now()
): ChangeInfoActionRunResult {
  return {
    key: operation.catalog.key,
    actionType: operation.catalog.actionType ?? '',
    label: operation.catalog.label,
    status,
    code,
    message,
    startedAt,
    finishedAt
  }
}

function isNeedsAttention(result: ScenarioActionWorkerResult): boolean {
  return result.summary.result.status === 'needs_attention'
    || result.sessionState === 'needs_login'
    || result.sessionState === 'verification_required'
}

export class ChangeInfoWorkspaceRunnerService {
  private readonly accounts: AccountRepository
  private readonly workspaces: ActionWorkspaceRepository
  private readonly active = new Map<number, ActiveChangeInfoRun>()
  private readonly starting = new Set<number>()
  private logSequence = 0

  constructor(
    database: Database.Database,
    private readonly workers: ScenarioActionWorkerManager,
    private readonly accountExecution: AccountExecutionCoordinator,
    private readonly getSettings: () => AppSettings
  ) {
    this.accounts = new AccountRepository(database)
    this.workspaces = new ActionWorkspaceRepository(database)
  }

  async start(workspaceId: number): Promise<ChangeInfoRunSnapshot> {
    const previous = this.active.get(workspaceId)
    if (previous && (previous.snapshot.state === 'running' || previous.snapshot.state === 'paused' || previous.snapshot.state === 'stopping')) {
      throw new Error('Workspace Sửa thông tin đang có phiên chạy.')
    }
    if (this.starting.has(workspaceId)) throw new Error('Workspace Sửa thông tin đang chuẩn bị phiên chạy.')
    this.starting.add(workspaceId)
    try {
      const workspace = this.workspaces.get(workspaceId)
      if (!workspace || workspace.type !== 'change_info') throw new Error(`Không tìm thấy workspace Sửa thông tin #${workspaceId}.`)
      const draft = parseChangeInfoWorkspaceDraft(workspace.configJson)
      const errors = validateChangeInfoWorkspaceDraft(draft)
      if (errors.length) throw new Error(errors.join(' '))

      const bindings = [...workspace.accounts].filter((binding) => binding.enabled).sort((left, right) => left.sortOrder - right.sortOrder)
      if (!bindings.length) throw new Error('Chưa có tài khoản được bật để chạy Sửa thông tin.')
      const accounts = bindings.map((binding) => this.accounts.getById(binding.accountId)).filter((account): account is AccountRecord => Boolean(account))
      if (accounts.length !== bindings.length) throw new Error('Một số tài khoản của workspace không còn tồn tại.')

      const operations = await this.snapshotOperations(draft)
      const runId = `change-info-${workspaceId}-${Date.now()}-${Math.floor(Math.random() * 10000)}`
      const snapshot: ChangeInfoRunSnapshot = {
        workspaceId,
        runId,
        state: 'running',
        accountConcurrency: Math.max(1, Math.min(draft.accountConcurrency, accounts.length || 1)),
        startedAt: Date.now(),
        finishedAt: null,
        message: null,
        accounts: accounts.map((account): ChangeInfoAccountRunRuntime => ({
          accountId: account.id,
          uid: account.uid,
          state: account.status === 'disabled' ? 'failed' : 'queued',
          currentActionKey: null,
          currentActionLabel: null,
          message: account.status === 'disabled' ? 'Tài khoản đang bị tắt trong Account Manager.' : null,
          results: []
        })),
        logs: []
      }
      const active: ActiveChangeInfoRun = { snapshot, stopRequested: false, runningKeys: new Map(), operations }
      this.active.set(workspaceId, active)
      this.log(active, 'info', `Bắt đầu phiên ${runId}: ${accounts.length} tài khoản, ${operations.length} thay đổi.`)
      void this.execute(active, accounts).catch((error) => {
        if (this.active.get(workspaceId) !== active) return
        active.snapshot.state = 'failed'
        active.snapshot.finishedAt = Date.now()
        active.snapshot.message = safeText(null, error instanceof Error ? error.message : String(error))
        this.log(active, 'error', active.snapshot.message)
      })
      return cloneSnapshot(snapshot)
    } finally {
      this.starting.delete(workspaceId)
    }
  }

  status(workspaceId: number): ChangeInfoRunSnapshot | null {
    const active = this.active.get(workspaceId)
    return active ? cloneSnapshot(active.snapshot) : null
  }

  pause(workspaceId: number): ChangeInfoRunSnapshot | null {
    const active = this.active.get(workspaceId)
    if (!active) return null
    if (active.snapshot.state !== 'running') return cloneSnapshot(active.snapshot)
    active.snapshot.state = 'paused'
    active.snapshot.message = 'Đã tạm dừng; action đang chạy sẽ dừng tại control point an toàn.'
    for (const [accountId, runKey] of active.runningKeys) this.workers.pause(accountId, runKey)
    this.log(active, 'warning', 'Tạm dừng phiên Sửa thông tin.')
    return cloneSnapshot(active.snapshot)
  }

  resume(workspaceId: number): ChangeInfoRunSnapshot | null {
    const active = this.active.get(workspaceId)
    if (!active) return null
    if (active.snapshot.state !== 'paused') return cloneSnapshot(active.snapshot)
    active.snapshot.state = 'running'
    active.snapshot.message = 'Đã tiếp tục.'
    for (const [accountId, runKey] of active.runningKeys) this.workers.resume(accountId, runKey)
    this.log(active, 'info', 'Tiếp tục phiên Sửa thông tin.')
    return cloneSnapshot(active.snapshot)
  }

  stop(workspaceId: number): ChangeInfoRunSnapshot | null {
    const active = this.active.get(workspaceId)
    if (!active) return null
    if (!['running', 'paused', 'stopping'].includes(active.snapshot.state)) return cloneSnapshot(active.snapshot)
    active.stopRequested = true
    active.snapshot.state = 'stopping'
    active.snapshot.message = 'Đang dừng; nếu Save đã xảy ra, action vẫn hoàn tất bước verify trước khi đóng.'
    for (const [accountId, runKey] of active.runningKeys) this.workers.stop(accountId, runKey)
    for (const account of active.snapshot.accounts) if (account.state === 'queued') account.state = 'stopped'
    this.log(active, 'warning', 'Đã nhận yêu cầu dừng phiên Sửa thông tin.')
    return cloneSnapshot(active.snapshot)
  }

  dispose(): void {
    for (const active of this.active.values()) {
      if (active.snapshot.state === 'running' || active.snapshot.state === 'paused' || active.snapshot.state === 'stopping') {
        this.stop(active.snapshot.workspaceId)
      }
    }
    this.workers.closeAll()
  }

  private async snapshotOperations(draft: ReturnType<typeof parseChangeInfoWorkspaceDraft>): Promise<OperationSnapshot[]> {
    const output: OperationSnapshot[] = []
    for (const catalog of enabledChangeInfoCatalogItems(draft)) {
      const source = draft.actions[catalog.key]!.source
      const frozenSource = JSON.parse(JSON.stringify(source)) as ChangeInfoDataSourceConfig
      if (source.type !== 'file') {
        output.push({ catalog, source: frozenSource })
        continue
      }
      const path = source.path?.trim()
      if (!path) throw new Error(`${catalog.label}: chưa chọn file dữ liệu.`)
      const content = await readFile(path, 'utf8')
      const values = content.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
      if (!values.length) throw new Error(`${catalog.label}: file dữ liệu không có dòng hợp lệ.`)
      output.push({ catalog, source: frozenSource, snapshotValues: values })
    }
    return output
  }

  private async execute(active: ActiveChangeInfoRun, accounts: AccountRecord[]): Promise<void> {
    const runnable = accounts.filter((account) => account.status !== 'disabled')
    for (const account of accounts.filter((item) => item.status === 'disabled')) {
      this.log(active, 'warning', 'Bỏ qua tài khoản đang bị tắt.', account.id)
    }

    await runRollingAccountPool({
      items: runnable,
      concurrency: active.snapshot.accountConcurrency,
      tryAcquire: (account) => this.accountExecution.tryAcquireLease(account.id),
      waitUntilRunnable: () => this.waitUntilRunnable(active),
      shouldStop: () => active.stopRequested,
      run: (account) => this.runAccount(active, account)
    })

    if (this.active.get(active.snapshot.workspaceId) !== active) return
    active.snapshot.finishedAt = Date.now()
    if (active.stopRequested) {
      active.snapshot.state = 'stopped'
      active.snapshot.message = 'Phiên Sửa thông tin đã dừng.'
      this.log(active, 'warning', active.snapshot.message)
      return
    }

    const states = active.snapshot.accounts.map((account) => account.state)
    const successful = states.filter((state) => state === 'success' || state === 'partial_success').length
    if (states.length > 0 && states.every((state) => state === 'success')) {
      active.snapshot.state = 'success'
      active.snapshot.message = 'Phiên Sửa thông tin hoàn tất và đã verify.'
    } else if (successful > 0) {
      active.snapshot.state = 'partial_success'
      active.snapshot.message = 'Phiên Sửa thông tin hoàn tất một phần; xem kết quả từng tài khoản/action.'
    } else if (states.some((state) => state === 'needs_attention')) {
      active.snapshot.state = 'needs_attention'
      active.snapshot.message = 'Phiên cần xử lý thủ công trên Facebook.'
    } else {
      active.snapshot.state = 'failed'
      active.snapshot.message = 'Không có tài khoản hoàn tất Sửa thông tin.'
    }
    this.log(active, active.snapshot.state === 'success' ? 'info' : 'warning', active.snapshot.message)
  }

  private async waitUntilRunnable(active: ActiveChangeInfoRun): Promise<boolean> {
    while (active.snapshot.state === 'paused' && !active.stopRequested) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
    }
    return !active.stopRequested
  }

  private async runAccount(active: ActiveChangeInfoRun, account: AccountRecord): Promise<void> {
    const runtime = this.accountRuntime(active, account.id)
    runtime.state = 'running'
    runtime.message = 'Đang chạy.'
    this.log(active, 'info', `Bắt đầu account ${account.uid}.`, account.id)
    let needsAttention = false
    let hardFailure = false

    try {
      const accountIndex = active.snapshot.accounts.findIndex((item) => item.accountId === account.id)
      for (const operation of active.operations) {
        if (active.stopRequested) break
        if (!await this.waitUntilRunnable(active)) break
        runtime.currentActionKey = operation.catalog.key
        runtime.currentActionLabel = operation.catalog.label
        const resolved = resolveChangeInfoDataSource(operation.source, {
          accountId: account.id,
          accountIndex,
          runSeed: `${active.snapshot.runId}:${operation.catalog.key}`,
          ...(operation.snapshotValues ? { snapshotValues: operation.snapshotValues } : {})
        })
        const startedAt = Date.now()
        if (resolved.status !== 'resolved') {
          runtime.results.push(actionResult(operation, 'failed', 'change_info_source_unresolved', resolved.reason, startedAt))
          hardFailure = true
          this.log(active, 'warning', `${operation.catalog.label}: ${resolved.reason}`, account.id, operation.catalog.actionType ?? undefined)
          continue
        }
        if (!operation.catalog.actionType) {
          runtime.results.push(actionResult(operation, 'failed', 'change_info_action_unbound', 'Action chưa có canonical actionType.', startedAt))
          hardFailure = true
          continue
        }

        const config = this.actionConfig(operation.catalog.actionType, resolved.value)
        if (!config) {
          runtime.results.push(actionResult(operation, 'failed', 'change_info_action_config_unavailable', 'Không map được dữ liệu sang config action.', startedAt))
          hardFailure = true
          continue
        }
        const runKey = `${active.snapshot.runId}:a${account.id}:${operation.catalog.key}:${runtime.results.length + 1}`
        const request: ActionRunRequest = {
          runKey,
          actionType: operation.catalog.actionType,
          label: operation.catalog.label,
          actor: { kind: 'profile', accountId: account.id, accountUid: account.uid },
          config,
          retry: { maxAttempts: 1, delayMs: 0, retryableCodes: [] }
        }
        const job = scenarioActionJobForCommonSessionPolicy(account, request, this.getSettings())
        active.runningKeys.set(account.id, runKey)
        this.log(active, 'info', `Chạy ${operation.catalog.label}.`, account.id, operation.catalog.actionType)
        const result = await this.workers.run(job, (event) => this.logActionEvent(active, account, event))
        active.runningKeys.delete(account.id)
        this.syncAccountSession(account, result)
        const action = result.summary.result
        runtime.results.push(actionResult(
          operation,
          action.status,
          action.code ?? null,
          action.message ?? null,
          result.summary.startedAt,
          result.summary.finishedAt
        ))

        if (isNeedsAttention(result)) {
          needsAttention = true
          runtime.message = action.message ?? 'Cần đăng nhập/xác minh thủ công.'
          break
        }
        if (action.status === 'failed') {
          hardFailure = true
          runtime.message = action.message ?? 'Action thất bại.'
          if (action.code === ACTION_VERIFICATION_UNCERTAIN_CODE) break
        }
        if (action.status === 'stopped') break
      }
    } catch (error) {
      hardFailure = true
      runtime.message = safeText(account, error instanceof Error ? error.message : String(error))
      this.log(active, 'error', runtime.message, account.id)
    } finally {
      active.runningKeys.delete(account.id)
      runtime.currentActionKey = null
      runtime.currentActionLabel = null
      if (active.stopRequested) {
        runtime.state = 'stopped'
        runtime.message = 'Đã dừng.'
      } else if (needsAttention) {
        runtime.state = 'needs_attention'
      } else {
        const successCount = runtime.results.filter((result) => result.status === 'success').length
        const failedCount = runtime.results.filter((result) => result.status === 'failed' || result.status === 'stopped').length
        if (successCount > 0 && failedCount > 0) runtime.state = 'partial_success'
        else if (successCount > 0 && !hardFailure) runtime.state = 'success'
        else runtime.state = 'failed'
        runtime.message = runtime.message ?? (runtime.state === 'success' ? 'Hoàn tất và đã verify.' : 'Hoàn tất với lỗi.')
      }
      await this.workers.closeAccount(account.id).catch(() => undefined)
      this.log(active, runtime.state === 'success' ? 'info' : 'warning', `Account ${account.uid}: ${runtime.message ?? runtime.state}`, account.id)
    }
  }

  private actionConfig(actionType: string, value: ChangeInfoDataScalar): Record<string, string> | null {
    if (actionType === 'profile.bio') return { bio: String(value) }
    return null
  }

  private syncAccountSession(account: AccountRecord, result: ScenarioActionWorkerResult): void {
    const now = Date.now()
    const nextName = result.accountName?.trim() || account.name
    if (result.sessionState === 'valid') {
      this.accounts.update(account.id, {
        status: 'valid',
        name: nextName,
        cookie: result.sessionCookie?.trim() || account.cookie,
        cookieStatus: 'valid',
        lastCookieCheck: now,
        lastUsedAt: now
      })
      return
    }
    if (result.sessionState === 'needs_login' || result.sessionState === 'verification_required') {
      this.accounts.update(account.id, {
        status: result.accountStatus ?? (result.sessionState === 'verification_required' ? 'checkpoint_unknown' : 'needs_login'),
        name: nextName,
        cookieStatus: 'needs_login',
        lastCookieCheck: now,
        lastUsedAt: now
      })
      return
    }
    if (nextName !== account.name) this.accounts.update(account.id, { name: nextName, lastUsedAt: now })
  }

  private accountRuntime(active: ActiveChangeInfoRun, accountId: number): ChangeInfoAccountRunRuntime {
    const runtime = active.snapshot.accounts.find((item) => item.accountId === accountId)
    if (!runtime) throw new Error(`Không tìm thấy runtime account #${accountId}.`)
    return runtime
  }

  private logActionEvent(active: ActiveChangeInfoRun, account: AccountRecord, event: ActionLogEvent): void {
    this.log(active, event.level, event.message, account.id, event.actionType)
  }

  private log(
    active: ActiveChangeInfoRun,
    level: ChangeInfoRunLogEntry['level'],
    message: string,
    accountId?: number,
    actionType?: string
  ): void {
    const account = accountId ? this.accounts.getById(accountId) : null
    const entry: ChangeInfoRunLogEntry = {
      id: ++this.logSequence,
      at: Date.now(),
      level,
      message: safeText(account, message),
      ...(accountId === undefined ? {} : { accountId }),
      ...(actionType === undefined ? {} : { actionType })
    }
    active.snapshot.logs.push(entry)
    if (active.snapshot.logs.length > 500) active.snapshot.logs.splice(0, active.snapshot.logs.length - 500)
  }
}
