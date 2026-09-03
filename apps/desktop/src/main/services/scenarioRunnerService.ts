import type Database from 'better-sqlite3'
import type { AccountRecord } from '../../shared/accounts'
import type { AppSettings } from '../../shared/appSettings'
import type { ActionLogEvent, ActionRunRequest } from '../../shared/actionRuntime'
import type { ScenarioActionWorkerJob, ScenarioActionWorkerResult } from '../../shared/scenarioActionWorker'
import type {
  ScenarioRunnerAccountRuntime,
  ScenarioRunnerLogEntry,
  ScenarioRunnerSnapshot,
  ScenarioRunnerStartPayload
} from '../../shared/scenarioRunnerRuntime'
import type { ScenarioActionRecord, ScenarioDetails } from '../../shared/scenarios'
import { parseStoryIds, type StoryRuntimeData } from '../../shared/story'
import { BrowserWindowLayoutManager } from '../browser/browserWindowLayoutManager'
import { ScenarioActionWorkerManager } from '../browser/scenarioActionWorkerManager'
import { AccountRepository } from '../database/accountRepository'
import { BrowserWindowLayoutRepository } from '../database/browserWindowLayoutRepository'
import { ScenarioRepository } from '../database/scenarioRepository'
import { StoryRepository } from '../database/storyRepository'
import { scenarioActionJobForCommonSessionPolicy } from '../facebook/facebookSessionPolicy'
import { AccountExecutionCoordinator } from './accountExecutionCoordinator'
import { redactExecutionText } from './executionLogSanitizer'
import { runRollingAccountPool } from './rollingAccountPool'

interface ActiveScenarioRun {
  snapshot: ScenarioRunnerSnapshot
  stopRequested: boolean
  runningKeys: Map<number, string>
  completedAccounts: number
  accountPauseUntil: number
  storyRuntimeByActionId: Map<number, StoryRuntimeData>
}

function uniqueIds(values: readonly number[]): number[] {
  const seen = new Set<number>()
  const result: number[] = []
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value <= 0 || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

function shuffled<T>(values: readonly T[]): T[] {
  const output = [...values]
  for (let index = output.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    const current = output[index]
    output[index] = output[target]!
    output[target] = current!
  }
  return output
}

function randomDelayMs(minSeconds: number, maxSeconds: number): number {
  const low = Math.max(0, Math.min(minSeconds, maxSeconds))
  const high = Math.max(low, Math.max(minSeconds, maxSeconds))
  if (high <= low) return Math.round(low * 1000)
  return Math.round((low + Math.random() * (high - low)) * 1000)
}

function accountSecrets(account: AccountRecord): Array<string | null | undefined> {
  return [account.password, account.cookie, account.twoFactorSecret, account.emailPassword, account.proxy, account.proxyPassword]
}

function safeText(account: AccountRecord | null, message: string): string {
  return redactExecutionText(message, account ? accountSecrets(account) : []) ?? 'Runtime event.'
}

function cloneSnapshot(snapshot: ScenarioRunnerSnapshot): ScenarioRunnerSnapshot {
  return {
    ...snapshot,
    accountRuntimes: snapshot.accountRuntimes.map((item) => ({ ...item })),
    logs: snapshot.logs.map((item) => ({ ...item }))
  }
}

function isNeedsAttention(result: ScenarioActionWorkerResult): boolean {
  return result.summary.result.status === 'needs_attention'
    || result.sessionState === 'needs_login'
    || result.sessionState === 'verification_required'
}

export class ScenarioRunnerService {
  private readonly accounts: AccountRepository
  private readonly scenarios: ScenarioRepository
  private readonly stories: StoryRepository
  private readonly browserWindowLayout = new BrowserWindowLayoutManager()
  private readonly browserWindowLayoutSettings: BrowserWindowLayoutRepository
  private active: ActiveScenarioRun | null = null
  private logSequence = 0

  constructor(
    database: Database.Database,
    private readonly workers: ScenarioActionWorkerManager,
    private readonly accountExecution: AccountExecutionCoordinator,
    private readonly dataDirectory: string,
    private readonly getSettings: () => AppSettings
  ) {
    this.accounts = new AccountRepository(database)
    this.scenarios = new ScenarioRepository(database)
    this.stories = new StoryRepository(database)
    this.browserWindowLayoutSettings = new BrowserWindowLayoutRepository(database)
  }

  start(payload: ScenarioRunnerStartPayload): ScenarioRunnerSnapshot {
    if (this.active && (this.active.snapshot.state === 'running' || this.active.snapshot.state === 'stopping')) {
      throw new Error('Đang có một phiên Kịch Bản chạy. Hãy dừng phiên hiện tại trước.')
    }
    if (payload.settings.secondaryProfile) throw new Error('Chạy bằng Profile phụ chưa được nối runtime; hãy tắt tùy chọn này.')
    if (payload.settings.proxyResetEnabled) throw new Error('Proxy Reset ngoài chưa được nối runtime; hãy tắt tùy chọn này.')
    if (payload.settings.dcomResetEnabled) throw new Error('Reset DCom chưa được nối runtime; hãy tắt tùy chọn này.')

    const accountIds = uniqueIds(payload.accountIds)
    const scenarioIds = uniqueIds(payload.scenarioIds)
    if (!accountIds.length) throw new Error('Chưa có tài khoản được bật để chạy.')
    if (!scenarioIds.length) throw new Error('Chưa chọn kịch bản để chạy.')

    const scenarios = scenarioIds.map((id) => this.scenarios.get(id)).filter((item): item is ScenarioDetails => Boolean(item))
    if (scenarios.length !== scenarioIds.length) throw new Error('Một số kịch bản đã chọn không còn tồn tại.')
    if (!scenarios.length) throw new Error('Không tìm thấy kịch bản hợp lệ.')
    if (!scenarios.some((scenario) => scenario.actions.some((action) => action.enabled))) {
      throw new Error('Các kịch bản đã chọn không có action nào được bật.')
    }

    const accounts = accountIds.map((id) => this.accounts.getById(id)).filter((item): item is AccountRecord => Boolean(item))
    if (accounts.length !== accountIds.length) throw new Error('Một số tài khoản đã chọn không còn tồn tại.')
    if (!accounts.length) throw new Error('Không tìm thấy tài khoản hợp lệ.')

    const runId = `scenario-${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const snapshot: ScenarioRunnerSnapshot = {
      runId,
      state: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      accountRuntimes: accountIds.map((accountId): ScenarioRunnerAccountRuntime => ({
        accountId,
        state: 'queued',
        total: 0,
        success: 0,
        currentScenarioId: null,
        currentScenarioName: null,
        currentActionType: null,
        currentActionLabel: null,
        message: null
      })),
      logs: [],
      message: null
    }
    const storyRuntimeByActionId = new Map<number, StoryRuntimeData>()
    for (const scenario of scenarios) {
      for (const action of scenario.actions) {
        if (action.actionType !== 'post_story') continue
        storyRuntimeByActionId.set(action.id, this.storyRuntimeData(this.parseConfig(action)))
      }
    }

    const active: ActiveScenarioRun = {
      snapshot,
      stopRequested: false,
      runningKeys: new Map(),
      completedAccounts: 0,
      accountPauseUntil: 0,
      storyRuntimeByActionId
    }
    this.active = active
    this.log(active, 'info', `Bắt đầu phiên ${runId}: ${accounts.length} tài khoản, ${scenarios.length} kịch bản.`)
    void this.execute(active, accounts, scenarios, payload).catch((error) => {
      if (this.active !== active) return
      active.snapshot.state = 'failed'
      active.snapshot.finishedAt = Date.now()
      const message = safeText(null, error instanceof Error ? error.message : String(error))
      active.snapshot.message = message
      this.log(active, 'error', message)
    })
    return cloneSnapshot(snapshot)
  }

  status(): ScenarioRunnerSnapshot | null {
    return this.active ? cloneSnapshot(this.active.snapshot) : null
  }

  stop(): ScenarioRunnerSnapshot | null {
    const active = this.active
    if (!active) return null
    if (active.snapshot.state !== 'running' && active.snapshot.state !== 'stopping') return cloneSnapshot(active.snapshot)
    active.stopRequested = true
    active.snapshot.state = 'stopping'
    active.snapshot.message = 'Đang dừng phiên theo yêu cầu.'
    for (const [accountId, runKey] of active.runningKeys) this.workers.stop(accountId, runKey)
    for (const runtime of active.snapshot.accountRuntimes) {
      if (runtime.state === 'queued') runtime.state = 'stopped'
    }
    this.log(active, 'warning', 'Đã nhận yêu cầu dừng; chờ action đang chạy trả control.')
    return cloneSnapshot(active.snapshot)
  }

  dispose(): void {
    if (this.active && (this.active.snapshot.state === 'running' || this.active.snapshot.state === 'stopping')) {
      this.stop()
    }
    this.workers.closeAll()
  }

  private async execute(
    active: ActiveScenarioRun,
    accounts: AccountRecord[],
    scenarios: ScenarioDetails[],
    payload: ScenarioRunnerStartPayload
  ): Promise<void> {
    const runnable = accounts.filter((account) => {
      if (account.status !== 'disabled') return true
      const runtime = this.accountRuntime(active, account.id)
      runtime.state = 'failed'
      runtime.message = 'Tài khoản đang bị tắt.'
      this.log(active, 'warning', 'Bỏ qua tài khoản đang bị tắt.', account.id)
      return false
    })
    const parallel = Math.max(1, Math.min(payload.settings.parallelAccounts, runnable.length || 1))

    await runRollingAccountPool({
      items: runnable,
      concurrency: parallel,
      tryAcquire: (account) => this.accountExecution.tryAcquireLease(account.id),
      waitUntilRunnable: async () => {
        while (!active.stopRequested) {
          const waitMs = active.accountPauseUntil - Date.now()
          if (waitMs <= 0) return true
          if (!await this.sleep(active, waitMs)) return false
        }
        return false
      },
      shouldStop: () => active.stopRequested,
      run: async (account) => {
        if (active.stopRequested) return
        await this.runAccount(active, account, scenarios, payload)
        active.completedAccounts += 1
        if (
          !active.stopRequested
          && payload.settings.pauseAfterAccounts > 0
          && active.completedAccounts < runnable.length
          && active.completedAccounts % payload.settings.pauseAfterAccounts === 0
          && payload.settings.pauseAfterAccountsMinutes > 0
        ) {
          active.accountPauseUntil = Math.max(
            active.accountPauseUntil,
            Date.now() + payload.settings.pauseAfterAccountsMinutes * 60_000
          )
          this.log(active, 'info', `Tạm dừng ${payload.settings.pauseAfterAccountsMinutes} phút sau ${active.completedAccounts} tài khoản.`)
        }
      },
      afterRelease: async (finishedAccount, context) => {
        if (active.stopRequested || context.remainingItems < 1) return
        const switchDelayMs = randomDelayMs(
          payload.settings.accountSwitchDelayMinSeconds,
          payload.settings.accountSwitchDelayMaxSeconds
        )
        if (switchDelayMs <= 0) return
        const displaySeconds = Math.max(1, Math.round(switchDelayMs / 1000))
        this.log(active, 'info', `Đã đóng account ${finishedAccount.uid}; chờ ${displaySeconds} giây trước khi mở tài khoản tiếp theo.`, finishedAccount.id)
        await this.sleep(active, switchDelayMs)
      }
    })

    if (this.active !== active) return
    active.snapshot.finishedAt = Date.now()
    if (active.stopRequested) {
      active.snapshot.state = 'stopped'
      active.snapshot.message = 'Phiên đã dừng.'
      this.log(active, 'warning', 'Phiên Kịch Bản đã dừng.')
    } else {
      const allFailed = active.snapshot.accountRuntimes.every((item) => item.state === 'failed' || item.state === 'needs_attention')
      active.snapshot.state = allFailed ? 'failed' : 'completed'
      const message = allFailed ? 'Phiên kết thúc nhưng không có tài khoản hoàn tất.' : 'Phiên đã hoàn tất.'
      active.snapshot.message = message
      this.log(active, allFailed ? 'error' : 'info', message)
    }
  }

  private async runAccount(
    active: ActiveScenarioRun,
    account: AccountRecord,
    scenarios: ScenarioDetails[],
    payload: ScenarioRunnerStartPayload
  ): Promise<void> {
    const runtime = this.accountRuntime(active, account.id)
    runtime.state = 'running'
    runtime.message = 'Đang chạy.'
    this.log(active, 'info', `Bắt đầu account ${account.uid}.`, account.id)
    let attempted = 0
    let ordinal = 0
    let hadFailure = false
    let needsAttention = false
    let pendingErrorPauseMs = 0

    try {
      const repeatCount = payload.settings.repeat ? Math.max(1, payload.settings.repeatCount) : 1
      runLoop:
      for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
        const scenarioPool = payload.settings.randomScenarios
          ? shuffled(scenarios).slice(0, Math.min(Math.max(1, payload.settings.randomScenarioCount), scenarios.length))
          : scenarios
        for (const scenario of scenarioPool) {
          if (active.stopRequested) break runLoop
          runtime.currentScenarioId = scenario.id
          runtime.currentScenarioName = scenario.name
          const scenarioDeadline = scenario.runtimeLimitMinutes
            ? Date.now() + scenario.runtimeLimitMinutes * 60_000
            : null
          const actions = scenario.randomActionOrder
            ? shuffled(scenario.actions.filter((action) => action.enabled))
            : scenario.actions.filter((action) => action.enabled)

          for (const action of actions) {
            if (active.stopRequested) break runLoop
            if (scenarioDeadline !== null && Date.now() >= scenarioDeadline) {
              this.log(active, 'warning', `Kịch bản “${scenario.name}” đã đạt giới hạn thời gian.`, account.id, scenario.id)
              break
            }
            if (ordinal < payload.settings.startIndex) {
              ordinal += 1
              continue
            }
            if (attempted >= payload.settings.limitPerAccount) break runLoop

            if (pendingErrorPauseMs > 0) {
              const pauseMs = pendingErrorPauseMs
              pendingErrorPauseMs = 0
              await this.workers.closeAccount(account.id).catch(() => undefined)
              this.browserWindowLayout.release(account.id, 'scenario')
              const pauseMinutes = Math.max(1, Math.round(pauseMs / 60_000))
              this.log(active, 'warning', `Đã đóng browser sau lỗi; tạm dừng ${pauseMinutes} phút trước action kế tiếp.`, account.id)
              if (!await this.sleep(active, pauseMs)) break runLoop
              if (scenarioDeadline !== null && Date.now() >= scenarioDeadline) {
                this.log(active, 'warning', `Kịch bản “${scenario.name}” đã đạt giới hạn thời gian trong lúc tạm dừng sau lỗi.`, account.id, scenario.id)
                break
              }
            }

            ordinal += 1
            attempted += 1
            runtime.total += 1
            runtime.currentActionType = action.actionType
            runtime.currentActionLabel = action.label
            const runKey = `${active.snapshot.runId}:a${account.id}:s${scenario.id}:r${repeatIndex}:x${action.id}:n${attempted}`
            active.runningKeys.set(account.id, runKey)
            const parsedConfig = this.parseConfig(action)
            const request: ActionRunRequest = {
              runKey,
              scenarioActionId: action.id,
              actionType: action.actionType,
              label: action.label,
              actor: { kind: 'profile', accountId: account.id, accountUid: account.uid },
              config: parsedConfig,
              ...(action.actionType === 'post_story' ? { runtimeData: active.storyRuntimeByActionId.get(action.id) ?? { stories: [] } } : {}),
              retry: { maxAttempts: 1, delayMs: 0, retryableCodes: [] }
            }
            const job = this.buildWorkerJob(account, request)
            this.log(active, 'info', `Chạy ${action.label}.`, account.id, scenario.id, action.actionType)

            let deadlineTimer: NodeJS.Timeout | null = null
            let scenarioTimedOut = false
            if (scenarioDeadline !== null) {
              const remaining = Math.max(0, scenarioDeadline - Date.now())
              deadlineTimer = setTimeout(() => {
                scenarioTimedOut = true
                this.workers.stop(account.id, runKey)
              }, remaining)
            }

            const result = await this.workers.run(job, (event) => this.logActionEvent(active, account, scenario, event))
            if (deadlineTimer) clearTimeout(deadlineTimer)
            active.runningKeys.delete(account.id)
            this.syncAccountSession(account, result)

            if (result.summary.result.status === 'success') runtime.success += 1
            if (isNeedsAttention(result)) {
              needsAttention = true
              runtime.state = 'needs_attention'
              runtime.message = result.summary.result.message ?? 'Cần đăng nhập/xác minh thủ công.'
              break runLoop
            }
            if (result.summary.result.status === 'stopped') {
              if (active.stopRequested) break runLoop
              if (scenarioTimedOut) {
                this.log(active, 'warning', `Kịch bản “${scenario.name}” đã hết giới hạn thời gian.`, account.id, scenario.id)
                break
              }
            }
            if (result.summary.result.status === 'failed') {
              hadFailure = true
              runtime.message = result.summary.result.message ?? 'Action thất bại.'
              if (payload.settings.pauseOnErrorMinutes > 0) {
                pendingErrorPauseMs = payload.settings.pauseOnErrorMinutes * 60_000
                this.log(active, 'warning', `Action lỗi; sẽ tạm dừng ${payload.settings.pauseOnErrorMinutes} phút trước action kế tiếp nếu còn.`, account.id, scenario.id, action.actionType)
              }
            }

            if (
              payload.settings.pauseAfterActions > 0
              && attempted % payload.settings.pauseAfterActions === 0
              && payload.settings.pauseMinutes > 0
            ) {
              this.log(active, 'info', `Tạm dừng ${payload.settings.pauseMinutes} phút sau ${attempted} action.`, account.id)
              if (!await this.sleep(active, payload.settings.pauseMinutes * 60_000)) break runLoop
            }
            const delayMs = randomDelayMs(payload.settings.actionDelayMinSeconds, payload.settings.actionDelayMaxSeconds)
            if (delayMs > 0 && !await this.sleep(active, delayMs)) break runLoop
          }
        }
      }
    } catch (error) {
      hadFailure = true
      const message = safeText(account, error instanceof Error ? error.message : String(error))
      runtime.message = message
      this.log(active, 'error', message, account.id, runtime.currentScenarioId ?? undefined, runtime.currentActionType ?? undefined)
    } finally {
      active.runningKeys.delete(account.id)
      runtime.currentActionType = null
      runtime.currentActionLabel = null
      runtime.currentScenarioId = null
      runtime.currentScenarioName = null
      if (active.stopRequested) {
        runtime.state = 'stopped'
        runtime.message = 'Đã dừng.'
      } else if (!needsAttention) {
        runtime.state = hadFailure ? 'failed' : 'completed'
        runtime.message = hadFailure ? 'Hoàn tất với lỗi action.' : 'Hoàn tất.'
      }

      await this.workers.closeAccount(account.id).catch(() => undefined)
      this.browserWindowLayout.release(account.id, 'scenario')

      const summaryMessage = needsAttention ? 'Cần xác minh thủ công.' : (runtime.message ?? runtime.state)
      const level: ScenarioRunnerLogEntry['level'] = runtime.state === 'failed' || runtime.state === 'needs_attention'
        ? 'warning'
        : 'info'
      this.log(active, level, `Account ${account.uid}: ${summaryMessage}`, account.id)
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

  private parseConfig(action: ScenarioActionRecord): unknown {
    try { return JSON.parse(action.configJson) as unknown } catch { return {} }
  }

  private storyRuntimeData(config: unknown): StoryRuntimeData {
    const storyIds = config && typeof config === 'object'
      ? parseStoryIds((config as Record<string, unknown>).storyIds)
      : []
    return { stories: this.stories.getByIds(storyIds) }
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

  private accountRuntime(active: ActiveScenarioRun, accountId: number): ScenarioRunnerAccountRuntime {
    const runtime = active.snapshot.accountRuntimes.find((item) => item.accountId === accountId)
    if (!runtime) throw new Error(`Không tìm thấy runtime account #${accountId}.`)
    return runtime
  }

  private logActionEvent(active: ActiveScenarioRun, account: AccountRecord, scenario: ScenarioDetails, event: ActionLogEvent): void {
    this.log(active, event.level, event.message, account.id, scenario.id, event.actionType)
  }

  private log(
    active: ActiveScenarioRun,
    level: ScenarioRunnerLogEntry['level'],
    message: string,
    accountId?: number,
    scenarioId?: number,
    actionType?: string
  ): void {
    const account = accountId ? this.accounts.getById(accountId) : null
    const entry: ScenarioRunnerLogEntry = {
      id: ++this.logSequence,
      at: Date.now(),
      level,
      message: safeText(account, message),
      ...(accountId === undefined ? {} : { accountId }),
      ...(scenarioId === undefined ? {} : { scenarioId }),
      ...(actionType === undefined ? {} : { actionType })
    }
    active.snapshot.logs.push(entry)
    if (active.snapshot.logs.length > 500) active.snapshot.logs.splice(0, active.snapshot.logs.length - 500)
  }

  private async sleep(active: ActiveScenarioRun, delayMs: number): Promise<boolean> {
    let remaining = Math.max(0, delayMs)
    while (remaining > 0) {
      if (active.stopRequested) return false
      const chunk = Math.min(1000, remaining)
      await new Promise<void>((resolve) => setTimeout(resolve, chunk))
      remaining -= chunk
    }
    return !active.stopRequested
  }
}
