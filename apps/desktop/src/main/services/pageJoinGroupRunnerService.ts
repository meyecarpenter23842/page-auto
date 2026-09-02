import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { AccountRecord } from '../../shared/accounts'
import type { AppSettings } from '../../shared/appSettings'
import type { ActionLogEvent, ActionRunRequest } from '../../shared/actionRuntime'
import {
  allocateGroupTargets,
  buildJoinGroupActionConfig,
  groupSourceNeedsTargets,
  groupSourceRequiresClaimForParallel,
  resolveGroupAccountConcurrency,
  splitGroupTargets,
  validateGroupWorkspaceDraft,
  type GroupWorkspaceDraft
} from '../../shared/groupWorkspaceConfig'
import type {
  InteractionWorkspaceRunAccountRuntime,
  InteractionWorkspaceRunLogEntry,
  InteractionWorkspaceRunSnapshot
} from '../../shared/interactionWorkspaceRunner'
import { parsePageJoinGroupWorkspaceConfig } from '../../shared/pageJoinGroup'
import type { ScenarioActionWorkerJob, ScenarioActionWorkerResult } from '../../shared/scenarioActionWorker'
import { resolveFacebookProfileDirectory } from '../browser/facebookProfileResolver'
import { resolveAccountProxyState } from '../browser/proxyConfig'
import { AccountRepository } from '../database/accountRepository'
import { ActionWorkspaceRepository } from '../database/actionWorkspaceRepository'
import { PageTabRepository } from '../database/pageTabRepository'
import { AccountExecutionCoordinator } from './accountExecutionCoordinator'
import { redactExecutionText } from './executionLogSanitizer'
import type { InteractionWorkspaceWorkerHost } from './interactionWorkspaceRunnerService'
import { runRollingAccountPool } from './rollingAccountPool'

interface FrozenPageJoinRun {
  pageTabId: number
  pageUid: string
  pageName: string
  draft: GroupWorkspaceDraft
  accounts: AccountRecord[]
  targetsByAccount: Map<number, string[]>
}

interface ActivePageJoinRun {
  snapshot: InteractionWorkspaceRunSnapshot
  frozen: FrozenPageJoinRun
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

function resultCount(result: ScenarioActionWorkerResult, key: 'attempted' | 'completed'): number | null {
  const raw = result.summary.result.data?.[key]
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : null
}

export class PageJoinGroupRunnerService {
  private readonly accounts: AccountRepository
  private readonly workspaces: ActionWorkspaceRepository
  private readonly pages: PageTabRepository
  private readonly active = new Map<number, ActivePageJoinRun>()
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
    this.pages = new PageTabRepository(database)
  }

  start(workspaceId: number): InteractionWorkspaceRunSnapshot {
    const current = this.active.get(workspaceId)
    if (current && ['running', 'paused', 'stopping'].includes(current.snapshot.state)) {
      throw new Error('Page này đang có phiên Tham gia nhóm.')
    }

    const workspace = this.workspaces.get(workspaceId)
    if (!workspace || workspace.type !== 'group') throw new Error(`Không tìm thấy binding Tham gia nhóm #${workspaceId}.`)
    const parsed = parsePageJoinGroupWorkspaceConfig(workspace.configJson)
    if (!parsed) throw new Error('Workspace Nhóm này không phải binding Page Tham gia nhóm.')

    const page = this.pages.get(parsed.pageTabId)
    if (!page) throw new Error(`Page #${parsed.pageTabId} không còn tồn tại trong Quản lý Page.`)
    const enabledPageAccounts = [...page.accounts]
      .filter((item) => item.enabled)
      .sort((left, right) => left.sortOrder - right.sortOrder)
    const accounts = enabledPageAccounts
      .map((binding) => this.accounts.getById(binding.accountId))
      .filter((account): account is AccountRecord => Boolean(account))
    if (accounts.length !== enabledPageAccounts.length) throw new Error('Một số account của Page không còn tồn tại.')

    const validationErrors = validateGroupWorkspaceDraft(parsed.draft, accounts.length)
    if (validationErrors.length) throw new Error(validationErrors.join(' '))

    const targetsByAccount = this.snapshotTargets(parsed.draft, accounts)
    const runId = `page-join-${workspace.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const now = Date.now()
    const snapshot: InteractionWorkspaceRunSnapshot = {
      runId,
      workspaceId: workspace.id,
      state: 'running',
      startedAt: now,
      finishedAt: null,
      frozen: {
        workspaceId: workspace.id,
        workspaceLabel: `${page.name} · Tham gia nhóm`,
        configJson: workspace.configJson,
        accountIds: accounts.map((account) => account.id),
        actionTypes: ['join_group'],
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

    const active: ActivePageJoinRun = {
      snapshot,
      frozen: {
        pageTabId: page.id,
        pageUid: page.pageUid,
        pageName: page.name,
        draft: parsed.draft,
        accounts,
        targetsByAccount
      },
      stopRequested: false,
      paused: false,
      runningKeys: new Map()
    }
    this.active.set(workspace.id, active)
    const concurrency = resolveGroupAccountConcurrency(parsed.draft, accounts.length)
    const claimGuard = groupSourceRequiresClaimForParallel(parsed.draft.sourceMode)
      ? ' Nguồn Group dùng chung tạm giữ 1 account cho tới khi atomic Group claim được nối.'
      : ''
    this.log(active, 'info', `Bắt đầu ${page.name}: ${accounts.length} account Page, tối đa ${concurrency} account chạy song song kiểu cuốn chiếu action Tham gia nhóm.${claimGuard}`)

    void this.execute(active).catch((error) => {
      if (this.active.get(workspace.id) !== active) return
      active.snapshot.state = 'failed'
      active.snapshot.finishedAt = Date.now()
      active.snapshot.message = safeText(null, error instanceof Error ? error.message : String(error))
      this.log(active, 'error', active.snapshot.message)
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
    active.snapshot.message = 'Đã tạm dừng phiên Tham gia nhóm của Page.'
    for (const [accountId, runKey] of active.runningKeys) this.workers.pause(accountId, runKey)
    for (const runtime of active.snapshot.accountRuntimes) if (runtime.state === 'running') runtime.state = 'paused'
    this.log(active, 'warning', 'Phiên Page Tham gia nhóm đã Pause.')
    return cloneSnapshot(active.snapshot)
  }

  resume(workspaceId: number): InteractionWorkspaceRunSnapshot | null {
    const active = this.active.get(workspaceId)
    if (!active) return null
    if (active.snapshot.state !== 'paused') return cloneSnapshot(active.snapshot)
    active.paused = false
    active.snapshot.state = 'running'
    active.snapshot.message = 'Đã tiếp tục snapshot Tham gia nhóm hiện tại.'
    for (const [accountId, runKey] of active.runningKeys) this.workers.resume(accountId, runKey)
    for (const runtime of active.snapshot.accountRuntimes) {
      if (runtime.state === 'paused') runtime.state = runtime.currentActionType ? 'running' : 'queued'
    }
    this.log(active, 'info', 'Phiên Page Tham gia nhóm đã Resume; không đọc lại config đang sửa.')
    return cloneSnapshot(active.snapshot)
  }

  stop(workspaceId: number): InteractionWorkspaceRunSnapshot | null {
    const active = this.active.get(workspaceId)
    if (!active) return null
    if (!['running', 'paused', 'stopping'].includes(active.snapshot.state)) return cloneSnapshot(active.snapshot)
    active.stopRequested = true
    active.paused = false
    active.snapshot.state = 'stopping'
    active.snapshot.message = 'Đang dừng phiên Page Tham gia nhóm.'
    for (const [accountId, runKey] of active.runningKeys) {
      this.workers.resume(accountId, runKey)
      this.workers.stop(accountId, runKey)
    }
    for (const runtime of active.snapshot.accountRuntimes) {
      if (runtime.state === 'queued' || runtime.state === 'paused') runtime.state = 'stopped'
    }
    this.log(active, 'warning', 'Đã nhận Stop; không cấp thêm account Page.')
    return cloneSnapshot(active.snapshot)
  }

  dispose(): void {
    for (const workspaceId of this.active.keys()) this.stop(workspaceId)
  }

  private snapshotTargets(draft: GroupWorkspaceDraft, accounts: AccountRecord[]): Map<number, string[]> {
    const result = new Map<number, string[]>()
    const inlineTargets = splitGroupTargets(draft.sourceTargets)
    for (let index = 0; index < accounts.length; index += 1) {
      const account = accounts[index]!
      if (draft.sourceMode === 'account_file') {
        result.set(account.id, this.readAccountTargets(draft.accountFilePath, account, accounts.length))
      } else {
        result.set(account.id, allocateGroupTargets(draft, inlineTargets, index, accounts.length))
      }
    }
    return result
  }

  private readAccountTargets(inputPath: string, account: AccountRecord, accountCount: number): string[] {
    const configured = inputPath.trim()
    let filePath = configured.includes('{uid}') ? configured.split('{uid}').join(account.uid) : configured
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, `${account.uid}.txt`)
    } else if (!configured.includes('{uid}') && accountCount > 1) {
      throw new Error('Nhiều account dùng 1 account / 1 file ID: hãy chọn folder chứa <UID>.txt hoặc dùng {uid}.')
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      throw new Error(`Không tìm thấy file Group ID cho account ${account.uid}.`)
    }
    return splitGroupTargets(readFileSync(filePath, 'utf8'))
  }

  private async execute(active: ActivePageJoinRun): Promise<void> {
    const concurrency = resolveGroupAccountConcurrency(active.frozen.draft, active.frozen.accounts.length)
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
      active.snapshot.message = 'Phiên Page Tham gia nhóm đã dừng.'
      this.log(active, 'warning', active.snapshot.message)
      return
    }
    const allFailed = active.snapshot.accountRuntimes.every((runtime) => runtime.state === 'failed' || runtime.state === 'needs_attention')
    active.snapshot.state = allFailed ? 'failed' : 'completed'
    active.snapshot.message = allFailed ? 'Không có account Page hoàn tất thành công.' : 'Phiên Page Tham gia nhóm đã hoàn tất.'
    this.log(active, allFailed ? 'error' : 'info', active.snapshot.message)
  }

  private async runAccount(active: ActivePageJoinRun, account: AccountRecord): Promise<void> {
    const runtime = this.accountRuntime(active, account.id)
    const targets = active.frozen.targetsByAccount.get(account.id) ?? []
    const draft = active.frozen.draft
    let hadFailure = false
    let needsAttention = false
    runtime.state = active.paused ? 'paused' : 'running'
    runtime.message = `Đang chạy Tham gia nhóm bằng Page ${active.frozen.pageName}.`
    this.log(active, 'info', `Bắt đầu account ${account.uid} → Page ${active.frozen.pageUid}.`, account.id)

    try {
      if (groupSourceNeedsTargets(draft.sourceMode) && targets.length === 0) {
        runtime.message = 'Account không được phân Group ID nào trong snapshot này.'
        this.log(active, 'info', runtime.message, account.id)
        return
      }
      const cycles = draft.repeatEnabled ? draft.repeatCount : 1
      for (let cycle = 1; cycle <= cycles; cycle += 1) {
        if (!await this.waitUntilRunnable(active) || active.stopRequested) break
        runtime.state = 'running'
        runtime.currentActionType = 'join_group'
        runtime.currentActionLabel = 'Tham gia nhóm'
        const runKey = `${active.snapshot.runId}:a${account.id}:c${cycle}`
        active.runningKeys.set(account.id, runKey)
        const request: ActionRunRequest = {
          runKey,
          actionType: 'join_group',
          label: 'Tham gia nhóm',
          actor: {
            kind: 'page',
            accountId: account.id,
            accountUid: account.uid,
            pageUid: active.frozen.pageUid
          },
          config: buildJoinGroupActionConfig(draft, targets),
          retry: { maxAttempts: 1, delayMs: 0, retryableCodes: [] }
        }
        const result = await this.workers.run(this.buildWorkerJob(account, request), (event) => this.logActionEvent(active, account, event))
        active.runningKeys.delete(account.id)
        this.syncAccountSession(account, result)
        runtime.attempted += resultCount(result, 'attempted') ?? 0
        runtime.success += resultCount(result, 'completed') ?? (result.summary.result.status === 'success' ? 1 : 0)
        if (isNeedsAttention(result)) {
          needsAttention = true
          runtime.state = 'needs_attention'
          runtime.message = result.summary.result.message ?? 'Cần đăng nhập/xác minh thủ công.'
          break
        }
        if (result.summary.result.status === 'stopped' && active.stopRequested) break
        if (result.summary.result.status === 'failed') {
          hadFailure = true
          runtime.message = result.summary.result.message ?? 'Tham gia nhóm thất bại.'
        } else if (result.summary.result.message) runtime.message = result.summary.result.message
      }
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
        runtime.message = hadFailure ? (runtime.message ?? 'Hoàn tất với lỗi action.') : (runtime.message ?? 'Hoàn tất.')
      }
      await this.workers.closeAccount(account.id).catch(() => undefined)
      this.log(active, runtime.state === 'failed' || runtime.state === 'needs_attention' ? 'warning' : 'info', `Account ${account.uid}: ${runtime.message ?? runtime.state}.`, account.id)
    }
  }

  private buildWorkerJob(account: AccountRecord, request: ActionRunRequest): ScenarioActionWorkerJob {
    const settings = this.getSettings()
    const profileDirectory = resolveFacebookProfileDirectory(this.dataDirectory, account, settings.browser).profileDirectory
    const proxyResolution = resolveAccountProxyState(account)
    if (proxyResolution.status === 'invalid') throw new Error(proxyResolution.message)
    const proxy = proxyResolution.status === 'valid' ? proxyResolution.proxy : undefined
    return {
      accountId: account.id,
      profileDirectory,
      browser: { ...settings.browser },
      session: { ...settings.session },
      network: { ...settings.network },
      sessionAccount: {
        id: account.id,
        uid: account.uid,
        username: account.username,
        password: account.password,
        cookie: account.cookie,
        twoFactorSecret: account.twoFactorSecret,
        name: account.name
      },
      request,
      ...(account.userAgent ? { userAgent: account.userAgent } : {}),
      ...(proxy ? { proxy } : {})
    }
  }

  private syncAccountSession(account: AccountRecord, result: ScenarioActionWorkerResult): void {
    const now = Date.now()
    const nextName = result.accountName?.trim() || account.name
    if (result.sessionState === 'valid') {
      this.accounts.update(account.id, {
        status: 'valid', name: nextName, cookie: result.sessionCookie?.trim() || account.cookie,
        cookieStatus: 'valid', lastCookieCheck: now, lastUsedAt: now
      })
      return
    }
    if (result.sessionState === 'needs_login' || result.sessionState === 'verification_required') {
      this.accounts.update(account.id, {
        status: result.accountStatus ?? (result.sessionState === 'verification_required' ? 'checkpoint_unknown' : 'needs_login'),
        name: nextName, cookieStatus: 'needs_login', lastCookieCheck: now, lastUsedAt: now
      })
      return
    }
    if (nextName !== account.name) this.accounts.update(account.id, { name: nextName, lastUsedAt: now })
  }

  private accountRuntime(active: ActivePageJoinRun, accountId: number): InteractionWorkspaceRunAccountRuntime {
    const runtime = active.snapshot.accountRuntimes.find((item) => item.accountId === accountId)
    if (!runtime) throw new Error(`Không tìm thấy runtime account #${accountId}.`)
    return runtime
  }

  private logActionEvent(active: ActivePageJoinRun, account: AccountRecord, event: ActionLogEvent): void {
    this.log(active, event.level, event.message, account.id, event.actionType)
  }

  private log(active: ActivePageJoinRun, level: InteractionWorkspaceRunLogEntry['level'], message: string, accountId?: number, actionType?: string): void {
    const account = accountId ? this.accounts.getById(accountId) : null
    active.snapshot.logs.push({
      id: ++this.logSequence,
      at: Date.now(),
      level,
      message: safeText(account, message),
      ...(accountId === undefined ? {} : { accountId }),
      ...(actionType === undefined ? {} : { actionType })
    })
    if (active.snapshot.logs.length > 500) active.snapshot.logs.splice(0, active.snapshot.logs.length - 500)
  }

  private async waitUntilRunnable(active: ActivePageJoinRun): Promise<boolean> {
    while (active.paused && !active.stopRequested) await new Promise<void>((resolve) => setTimeout(resolve, 200))
    return !active.stopRequested
  }
}
