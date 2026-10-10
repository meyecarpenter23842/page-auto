import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { AccountRecord } from '../../shared/accounts'
import type { AppSettings } from '../../shared/appSettings'
import type { ActionLogEvent, ActionRunRequest } from '../../shared/actionRuntime'
import {
  parseInteractionWorkspaceDraft,
  splitInteractionValues,
  type InteractionWorkspaceDraft
} from '../../shared/interactionWorkspaceConfig'
import type {
  InteractionWorkspaceRunAccountRuntime,
  InteractionWorkspaceRunLogEntry,
  InteractionWorkspaceRunSnapshot
} from '../../shared/interactionWorkspaceRunner'
import type { ScenarioActionWorkerJob, ScenarioActionWorkerResult } from '../../shared/scenarioActionWorker'
import { BrowserWindowLayoutManager } from '../browser/browserWindowLayoutManager'
import { AccountRepository } from '../database/accountRepository'
import { ActionWorkspaceRepository } from '../database/actionWorkspaceRepository'
import { BrowserWindowLayoutRepository } from '../database/browserWindowLayoutRepository'
import { scenarioActionJobForCommonSessionPolicy } from '../facebook/facebookSessionPolicy'
import { AccountExecutionCoordinator } from './accountExecutionCoordinator'
import { redactExecutionText } from './executionLogSanitizer'
import {
  allocateInteractionTargets,
  composeInteractionActions,
  interactionWorkspaceActionTypes,
  validateInteractionWorkspaceRun
} from './interactionWorkspaceComposition'
import { runRollingAccountPool } from './rollingAccountPool'

export interface InteractionWorkspaceWorkerHost {
  run(job: ScenarioActionWorkerJob, onLog?: (event: ActionLogEvent) => void): Promise<ScenarioActionWorkerResult>
  pause(accountId: number, runKey: string): void
  resume(accountId: number, runKey: string): void
  stop(accountId: number, runKey: string): void
  closeAccount(accountId: number): Promise<void>
  closeAll(): void
}

interface FrozenInteractionRun {
  draft: InteractionWorkspaceDraft
  accounts: AccountRecord[]
  targetsByAccount: Map<number, string[]>
}

interface ActiveInteractionRun {
  snapshot: InteractionWorkspaceRunSnapshot
  frozen: FrozenInteractionRun
  stopRequested: boolean
  paused: boolean
  runningKeys: Map<number, string>
}

function cloneSnapshot(snapshot: InteractionWorkspaceRunSnapshot): InteractionWorkspaceRunSnapshot {
  return {
    ...snapshot,
    frozen: {
      ...snapshot.frozen,
      accountIds: [...snapshot.frozen.accountIds],
      actionTypes: [...snapshot.frozen.actionTypes]
    },
    accountRuntimes: snapshot.accountRuntimes.map((item) => ({ ...item })),
    logs: snapshot.logs.map((item) => ({ ...item }))
  }
}

function accountSecrets(account: AccountRecord): Array<string | null | undefined> {
  return [account.password, account.cookie, account.twoFactorSecret, account.emailPassword, account.proxy, account.proxyPassword]
}

function safeText(account: AccountRecord | null, message: string): string {
  return redactExecutionText(message, account ? accountSecrets(account) : []) ?? 'Runtime event.'
}

function isNeedsAttention(result: ScenarioActionWorkerResult): boolean {
  return result.summary.result.status === 'needs_attention'
    || result.sessionState === 'needs_login'
    || result.sessionState === 'verification_required'
}

export class InteractionWorkspaceRunnerService {
  private readonly accounts: AccountRepository
  private readonly workspaces: ActionWorkspaceRepository
  private readonly browserWindowLayout = new BrowserWindowLayoutManager()
  private readonly browserWindowLayoutSettings: BrowserWindowLayoutRepository
  private readonly active = new Map<number, ActiveInteractionRun>()
  private logSequence = 0

  constructor(
    database: Database.Database,
    private readonly workers: InteractionWorkspaceWorkerHost,
    private readonly accountExecution: AccountExecutionCoordinator,
    private readonly dataDirectory: string,
    private readonly getSettings: () => AppSettings
  ) {
    this.accounts = new AccountRepository(database)
    this.workspaces = new ActionWorkspaceRepository(database)
    this.browserWindowLayoutSettings = new BrowserWindowLayoutRepository(database)
  }

  start(workspaceId: number): InteractionWorkspaceRunSnapshot {
    const current = this.active.get(workspaceId)
    if (current && ['running', 'paused', 'stopping'].includes(current.snapshot.state)) {
      throw new Error('Workspace này đang có phiên chạy.')
    }

    const workspace = this.workspaces.get(workspaceId)
    if (!workspace) throw new Error(`Không tìm thấy workspace #${workspaceId}.`)
    if (workspace.type !== 'interaction') throw new Error('Runner này chỉ nhận workspace Tương tác.')

    const draft = parseInteractionWorkspaceDraft(workspace.configJson)
    const enabledBindings = [...workspace.accounts]
      .filter((item) => item.enabled)
      .sort((left, right) => left.sortOrder - right.sortOrder)
    const accounts = enabledBindings
      .map((binding) => this.accounts.getById(binding.accountId))
      .filter((account): account is AccountRecord => Boolean(account))
    if (accounts.length !== enabledBindings.length) throw new Error('Một số account binding không còn tồn tại.')

    const validationErrors = validateInteractionWorkspaceRun(draft, accounts.length)
    if (validationErrors.length) throw new Error(validationErrors.join(' '))

    const targetsByAccount = this.snapshotTargets(draft, accounts)
    const runId = `interaction-${workspace.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const now = Date.now()
    const snapshot: InteractionWorkspaceRunSnapshot = {
      runId,
      workspaceId: workspace.id,
      state: 'running',
      startedAt: now,
      finishedAt: null,
      frozen: {
        workspaceId: workspace.id,
        workspaceLabel: workspace.label,
        configJson: workspace.configJson,
        accountIds: accounts.map((account) => account.id),
        actionTypes: interactionWorkspaceActionTypes(draft),
        createdAt: now
      },
      accountRuntimes: accounts.map((account): InteractionWorkspaceRunAccountRuntime => ({
        accountId: account.id,
        accountUid: account.uid,
        state: 'queued',
        attempted: 0,
        success: 0,
        currentActionType: null,
        currentActionLabel: null,
        message: null
      })),
      logs: [],
      message: null
    }

    const active: ActiveInteractionRun = {
      snapshot,
      frozen: { draft, accounts, targetsByAccount },
      stopRequested: false,
      paused: false,
      runningKeys: new Map()
    }
    this.active.set(workspaceId, active)
    const concurrency = Math.min(draft.accountConcurrency, accounts.length)
    this.log(
      active,
      'info',
      `Bắt đầu phiên ${runId}: ${accounts.length} account, tối đa ${concurrency} account chạy song song kiểu cuốn chiếu, ${snapshot.frozen.actionTypes.length} module.`
    )

    void this.execute(active).catch((error) => {
      if (this.active.get(workspaceId) !== active) return
      active.snapshot.state = 'failed'
      active.snapshot.finishedAt = Date.now()
      const message = safeText(null, error instanceof Error ? error.message : String(error))
      active.snapshot.message = message
      this.log(active, 'error', message)
    })
    return cloneSnapshot(snapshot)
  }

  status(workspaceId: number): InteractionWorkspaceRunSnapshot | null {
    const active = this.active.get(workspaceId)
    return active ? cloneSnapshot(active.snapshot) : null
  }

  pause(workspaceId: number): InteractionWorkspaceRunSnapshot | null {
    const active = this.active.get(workspaceId)
    if (!active) return null
    if (active.snapshot.state !== 'running') return cloneSnapshot(active.snapshot)
    active.paused = true
    active.snapshot.state = 'paused'
    active.snapshot.message = 'Đã tạm dừng; action đang chạy sẽ dừng tại cooperative pause point.'
    for (const [accountId, runKey] of active.runningKeys) this.workers.pause(accountId, runKey)
    for (const runtime of active.snapshot.accountRuntimes) {
      if (runtime.state === 'running') runtime.state = 'paused'
    }
    this.log(active, 'warning', 'Phiên đã Pause.')
    return cloneSnapshot(active.snapshot)
  }

  resume(workspaceId: number): InteractionWorkspaceRunSnapshot | null {
    const active = this.active.get(workspaceId)
    if (!active) return null
    if (active.snapshot.state !== 'paused') return cloneSnapshot(active.snapshot)
    active.paused = false
    active.snapshot.state = 'running'
    active.snapshot.message = 'Đã tiếp tục phiên snapshot hiện tại; Common Session Policy sẽ đọc credential canonical mới nhất trước action kế tiếp.'
    for (const [accountId, runKey] of active.runningKeys) this.workers.resume(accountId, runKey)
    for (const runtime of active.snapshot.accountRuntimes) {
      if (runtime.state === 'paused') runtime.state = runtime.currentActionType ? 'running' : 'queued'
    }
    this.log(active, 'info', 'Phiên đã Resume; business snapshot giữ nguyên, credential/session sẽ re-hydrate tại Common Session Policy.')
    return cloneSnapshot(active.snapshot)
  }

  stop(workspaceId: number): InteractionWorkspaceRunSnapshot | null {
    const active = this.active.get(workspaceId)
    if (!active) return null
    if (!['running', 'paused', 'stopping'].includes(active.snapshot.state)) return cloneSnapshot(active.snapshot)
    active.stopRequested = true
    active.paused = false
    active.snapshot.state = 'stopping'
    active.snapshot.message = 'Đang dừng phiên theo yêu cầu.'
    for (const [accountId, runKey] of active.runningKeys) {
      this.workers.resume(accountId, runKey)
      this.workers.stop(accountId, runKey)
    }
    for (const runtime of active.snapshot.accountRuntimes) {
      if (runtime.state === 'queued' || runtime.state === 'paused') runtime.state = 'stopped'
    }
    this.log(active, 'warning', 'Đã nhận Stop; không chạy thêm action/account mới.')
    return cloneSnapshot(active.snapshot)
  }

  dispose(): void {
    for (const workspaceId of this.active.keys()) this.stop(workspaceId)
    this.workers.closeAll()
  }

  private snapshotTargets(draft: InteractionWorkspaceDraft, accounts: AccountRecord[]): Map<number, string[]> {
    const result = new Map<number, string[]>()
    const inlineTargets = splitInteractionValues(draft.targetValues)
    for (let index = 0; index < accounts.length; index += 1) {
      const account = accounts[index]!
      if (draft.targetMode === 'uid_account_file') {
        result.set(account.id, this.readAccountTargets(draft.uidFilePath, account, accounts.length))
      } else {
        result.set(account.id, allocateInteractionTargets(draft, inlineTargets, index, accounts.length))
      }
    }
    return result
  }

  private readAccountTargets(inputPath: string, account: AccountRecord, accountCount: number): string[] {
    const configured = inputPath.trim()
    let filePath = configured.includes('{uid}')
      ? configured.split('{uid}').join(account.uid)
      : configured

    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, `${account.uid}.txt`)
    } else if (!configured.includes('{uid}') && accountCount > 1) {
      throw new Error('Nhiều account dùng chế độ file UID: hãy chọn folder chứa <UID>.txt hoặc dùng {uid} trong đường dẫn mẫu.')
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      throw new Error(`Không tìm thấy file UID cho account ${account.uid}.`)
    }
    return splitInteractionValues(readFileSync(filePath, 'utf8'))
  }

  private async execute(active: ActiveInteractionRun): Promise<void> {
    const concurrency = Math.min(active.frozen.draft.accountConcurrency, active.frozen.accounts.length)
    await runRollingAccountPool({
      items: active.frozen.accounts,
      concurrency,
      tryAcquire: (account) => this.accountExecution.tryAcquireLease(account.id),
      waitUntilRunnable: () => this.waitUntilRunnable(active),
      shouldStop: () => active.stopRequested,
      run: async (account) => {
        if (active.stopRequested) return
        const runtime = this.accountRuntime(active, account.id)
        if (account.status === 'disabled') {
          runtime.state = 'failed'
          runtime.message = 'Account đang bị tắt trong Account Manager.'
          this.log(active, 'warning', runtime.message, account.id)
          return
        }
        await this.runAccount(active, account)
      }
    })

    if (this.active.get(active.snapshot.workspaceId) !== active) return
    active.snapshot.finishedAt = Date.now()
    if (active.stopRequested) {
      active.snapshot.state = 'stopped'
      active.snapshot.message = 'Phiên đã dừng.'
      this.log(active, 'warning', 'Phiên Tương tác đã dừng.')
      return
    }

    const allFailed = active.snapshot.accountRuntimes.every((runtime) => (
      runtime.state === 'failed' || runtime.state === 'needs_attention'
    ))
    active.snapshot.state = allFailed ? 'failed' : 'completed'
    active.snapshot.message = allFailed ? 'Không có account hoàn tất thành công.' : 'Phiên đã hoàn tất.'
    this.log(active, allFailed ? 'error' : 'info', active.snapshot.message)
  }

  private async runAccount(active: ActiveInteractionRun, account: AccountRecord): Promise<void> {
    const runtime = this.accountRuntime(active, account.id)
    const targets = active.frozen.targetsByAccount.get(account.id) ?? []
    let hadFailure = false
    let needsAttention = false
    let cycle = 0

    runtime.state = active.paused ? 'paused' : 'running'
    runtime.message = 'Đang chạy.'
    this.log(active, 'info', `Bắt đầu account ${account.uid}.`, account.id)

    try {
      do {
        cycle += 1
        const actions = composeInteractionActions(active.frozen.draft, targets)
        if (!actions.length) {
          runtime.message = targets.length ? 'Không có module phù hợp.' : 'Account không được phân target trong snapshot này.'
          this.log(active, 'info', runtime.message, account.id)
          break
        }

        for (let index = 0; index < actions.length; index += 1) {
          if (!await this.waitUntilRunnable(active)) break
          if (active.stopRequested) break

          const action = actions[index]!
          runtime.state = 'running'
          runtime.attempted += 1
          runtime.currentActionType = action.actionType
          runtime.currentActionLabel = action.label
          const runKey = `${active.snapshot.runId}:a${account.id}:c${cycle}:x${index + 1}:n${runtime.attempted}`
          active.runningKeys.set(account.id, runKey)

          const request: ActionRunRequest = {
            runKey,
            actionType: action.actionType,
            label: action.label,
            actor: active.frozen.draft.actor === 'page'
              ? {
                  kind: 'page',
                  accountId: account.id,
                  accountUid: account.uid,
                  pageUid: active.frozen.draft.pageUid.trim()
                }
              : {
                  kind: 'profile',
                  accountId: account.id,
                  accountUid: account.uid
                },
            config: action.config,
            retry: { maxAttempts: 1, delayMs: 0, retryableCodes: [] }
          }

          this.log(active, 'info', `Chạy ${action.label}.`, account.id, action.actionType)
          const result = await this.workers.run(
            this.buildWorkerJob(account, request),
            (event) => this.logActionEvent(active, account, event)
          )
          active.runningKeys.delete(account.id)
          this.syncAccountSession(account, result)

          if (result.summary.result.status === 'success') runtime.success += 1
          if (isNeedsAttention(result)) {
            needsAttention = true
            runtime.state = 'needs_attention'
            runtime.message = result.summary.result.message ?? 'Cần đăng nhập/xác minh thủ công.'
            break
          }
          if (result.summary.result.status === 'stopped' && active.stopRequested) break
          if (result.summary.result.status === 'failed') {
            hadFailure = true
            runtime.message = result.summary.result.message ?? 'Action thất bại.'
          }
        }

        if (needsAttention || active.stopRequested || !active.frozen.draft.repeat) break
        if (!await this.waitUntilRunnable(active)) break
        this.log(active, 'debug', `Repeat cycle ${cycle + 1}.`, account.id)
      } while (!active.stopRequested)
    } catch (error) {
      hadFailure = true
      runtime.message = safeText(account, error instanceof Error ? error.message : String(error))
      this.log(active, 'error', runtime.message, account.id, runtime.currentActionType ?? undefined)
    } finally {
      active.runningKeys.delete(account.id)
      runtime.currentActionType = null
      runtime.currentActionLabel = null
      if (active.stopRequested) {
        runtime.state = 'stopped'
        runtime.message = 'Đã dừng.'
      } else if (!needsAttention) {
        runtime.state = hadFailure ? 'failed' : 'completed'
        runtime.message = hadFailure ? 'Hoàn tất với lỗi action.' : (runtime.message ?? 'Hoàn tất.')
      }
      await this.workers.closeAccount(account.id).catch(() => undefined)
      this.browserWindowLayout.release(account.id, 'scenario')
      this.log(
        active,
        runtime.state === 'failed' || runtime.state === 'needs_attention' ? 'warning' : 'info',
        `Account ${account.uid}: ${runtime.message ?? runtime.state}.`,
        account.id
      )
    }
  }

  private buildWorkerJob(account: AccountRecord, request: ActionRunRequest): ScenarioActionWorkerJob {
    const settings = this.getSettings()
    this.browserWindowLayout.claim(account.id, 'scenario')
    const browserPlacement = this.browserWindowLayout.placementFor(
      account.id,
      this.browserWindowLayoutSettings.get(),
      settings.browser
    )
    return scenarioActionJobForCommonSessionPolicy(account, request, settings, browserPlacement)
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
        status: result.accountStatus
          ?? (result.sessionState === 'verification_required' ? 'checkpoint_unknown' : 'needs_login'),
        name: nextName,
        cookieStatus: 'needs_login',
        lastCookieCheck: now,
        lastUsedAt: now
      })
      return
    }
    if (nextName !== account.name) this.accounts.update(account.id, { name: nextName, lastUsedAt: now })
  }

  private accountRuntime(active: ActiveInteractionRun, accountId: number): InteractionWorkspaceRunAccountRuntime {
    const runtime = active.snapshot.accountRuntimes.find((item) => item.accountId === accountId)
    if (!runtime) throw new Error(`Không tìm thấy runtime account #${accountId}.`)
    return runtime
  }

  private logActionEvent(active: ActiveInteractionRun, account: AccountRecord, event: ActionLogEvent): void {
    this.log(active, event.level, event.message, account.id, event.actionType)
  }

  private log(
    active: ActiveInteractionRun,
    level: InteractionWorkspaceRunLogEntry['level'],
    message: string,
    accountId?: number,
    actionType?: string
  ): void {
    const account = accountId ? this.accounts.getById(accountId) : null
    const entry: InteractionWorkspaceRunLogEntry = {
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

  private async waitUntilRunnable(active: ActiveInteractionRun): Promise<boolean> {
    while (active.paused && !active.stopRequested) {
      await new Promise<void>((resolve) => setTimeout(resolve, 200))
    }
    return !active.stopRequested
  }
}
