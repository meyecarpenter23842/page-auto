import { DEFAULT_APP_SETTINGS, type NetworkSettings, type SessionSettings } from '../../shared/appSettings'
import type { PageTabScheduleInput } from '../../shared/pageTabs'
import type { ExecuteSinglePostingJobResult } from '../../shared/posting'
import type { RotationPageTabPayload, RotationRuntimeSnapshot, RotationRuntimeStatus } from '../../shared/rotation'
import type { RunDetails, RunSnapshotAccount } from '../../shared/runs'
import type { AccountExecutionCoordinator } from './accountExecutionCoordinator'
import { resolveNetworkFailureDecision } from './networkFailurePolicy'
import { runRollingAccountPool, type RollingPoolLease } from './rollingAccountPool'
import {
  isWithinSchedule,
  nextScheduleStart,
  nextScheduleWindowStart,
  randomDelaySeconds,
  scheduleWindowKey
} from './rotationSchedule'
import type { RotationPostingExecutor, RotationRunStore } from './rotationServiceCore'
import { resolveSessionFailureDecision } from './sessionFailurePolicy'

interface RotationClock {
  now: () => Date
  random: () => number
  sleep: (milliseconds: number) => Promise<void>
}

interface ParallelTurn {
  account: RunSnapshotAccount
  index: number
  targetSlots: number
  completedSlots: number
  done: boolean
  unavailable: boolean
  usedSlot: boolean
  leaveAccountEarly: boolean
}

interface ParallelRotationSession {
  pageTabId: number
  runId: number
  status: RotationRuntimeStatus
  currentAccountId: number | null
  currentAccountIndex: number | null
  slotsCompletedThisTurn: number
  targetSlotsThisTurn: number
  cycle: number
  nextActionAt: number | null
  message: string | null
  lastResult: ExecuteSinglePostingJobResult['result'] | null
  run: RunDetails
  manualPaused: boolean
  stopRequested: boolean
  inFlightCount: number
  activeDateKey: string | null
  activeWindowKey: string | null
  completedWindowKey: string | null
  disposed: boolean
  turns: ParallelTurn[]
}

const defaultClock: RotationClock = {
  now: () => new Date(),
  random: () => Math.random(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
}

const noOpLease: RollingPoolLease = { release: () => undefined }

function localDateKey(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

function startedDateKey(run: RunDetails): string | null {
  return run.run.startedAt === null ? null : localDateKey(new Date(run.run.startedAt))
}

function sortedEnabledAccounts(run: RunDetails): RunSnapshotAccount[] {
  return run.run.snapshot.accounts.filter((account) => account.enabled).sort((a, b) => a.sortOrder - b.sortOrder)
}

function randomizedAccounts(accounts: RunSnapshotAccount[], random: () => number): RunSnapshotAccount[] {
  const result = [...accounts]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.max(0, Math.min(index, Math.floor(random() * (index + 1))))
    const current = result[index]
    const other = result[target]
    if (!current || !other) continue
    result[index] = other
    result[target] = current
  }
  return result
}

function accountsForNewCycle(run: RunDetails, random: () => number): RunSnapshotAccount[] {
  const accounts = sortedEnabledAccounts(run)
  return (run.run.snapshot.rotation.accountOrderMode ?? 'sequential') === 'random'
    ? randomizedAccounts(accounts, random)
    : accounts
}

function isRunExhausted(run: RunDetails): boolean {
  return run.run.status === 'completed' || run.metrics.remaining === 0
}

function isAccountUnavailable(result: ExecuteSinglePostingJobResult): boolean {
  return result.item === null && (
    result.result.code === 'needs_login' ||
    result.result.code === 'verification_required' ||
    result.result.code === 'account_disabled' ||
    result.result.code === 'no_enabled_account'
  )
}

function snapshotSession(session: ParallelRotationSession): RotationRuntimeSnapshot {
  return {
    pageTabId: session.pageTabId,
    runId: session.runId,
    status: session.status,
    currentAccountId: session.currentAccountId,
    currentAccountIndex: session.currentAccountIndex,
    slotsCompletedThisTurn: session.slotsCompletedThisTurn,
    targetSlotsThisTurn: session.targetSlotsThisTurn,
    cycle: session.cycle,
    nextActionAt: session.nextActionAt,
    message: session.message,
    lastResult: session.lastResult,
    run: session.run
  }
}

export class ParallelRotationService {
  private session: ParallelRotationSession | null = null
  private cyclePromise: Promise<void> = Promise.resolve()
  private resolveCycle: (() => void) | null = null

  constructor(
    private readonly runs: RotationRunStore,
    private readonly posting: RotationPostingExecutor,
    private readonly accountExecution?: AccountExecutionCoordinator,
    private readonly clock: RotationClock = defaultClock,
    private readonly getSessionSettings: () => SessionSettings = () => ({ ...DEFAULT_APP_SETTINGS.session }),
    private readonly getNetworkSettings: () => NetworkSettings = () => ({ ...DEFAULT_APP_SETTINGS.network }),
    private readonly getLiveSchedules: (pageTabId: number) => PageTabScheduleInput[] | null = () => null
  ) {}

  start(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    const existing = this.session
    if (existing && !['completed', 'error', 'stopped'].includes(existing.status)) return snapshotSession(existing)

    let run = this.runs.getLatestForPageTab(payload.pageTabId)
    if (!run || ['completed', 'stopped', 'failed'].includes(run.run.status)) run = this.runs.createForPageTab(payload.pageTabId)
    else if (run.run.status === 'running') throw new Error(`Phiên #${run.run.id} đang chạy ngoài bộ điều phối tài khoản. Hãy tạm dừng phiên trước khi bắt đầu.`)

    const accounts = sortedEnabledAccounts(run)
    if (!accounts.length) throw new Error('Page Tab không có tài khoản được bật để chạy.')
    const state = this.runs.getRotationState?.(run.run.id) ?? { activeDateKey: startedDateKey(run), completedWindowKey: null }
    const session: ParallelRotationSession = {
      pageTabId: payload.pageTabId,
      runId: run.run.id,
      status: 'starting',
      currentAccountId: null,
      currentAccountIndex: null,
      slotsCompletedThisTurn: 0,
      targetSlotsThisTurn: 0,
      cycle: 0,
      nextActionAt: null,
      message: `Đang khởi động rolling pool tối đa ${this.concurrency(run)} tài khoản.`,
      lastResult: null,
      run,
      manualPaused: false,
      stopRequested: false,
      inFlightCount: 0,
      activeDateKey: state.activeDateKey,
      activeWindowKey: null,
      completedWindowKey: state.completedWindowKey,
      disposed: false,
      turns: []
    }
    this.attach(session)
    return snapshotSession(session)
  }

  status(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    if (this.session?.pageTabId === payload.pageTabId) return snapshotSession(this.session)
    const run = this.runs.getLatestForPageTab(payload.pageTabId)
    const status = run?.run.status
    return {
      pageTabId: payload.pageTabId,
      runId: run?.run.id ?? null,
      status: status === 'completed' ? 'completed' : status === 'paused' ? 'paused' : status === 'stopped' ? 'stopped' : 'idle',
      currentAccountId: null,
      currentAccountIndex: null,
      slotsCompletedThisTurn: 0,
      targetSlotsThisTurn: 0,
      cycle: 0,
      nextActionAt: null,
      message: status === 'stopped' ? 'Page Tab đã Stop. Bấm Bắt đầu để tạo run mới từ Group gốc.' : null,
      lastResult: null,
      run
    }
  }

  pause(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    const session = this.requireSession(payload.pageTabId)
    if (['completed', 'error', 'stopping', 'stopped'].includes(session.status)) return snapshotSession(session)
    session.manualPaused = true
    session.status = 'paused'
    session.nextActionAt = null
    session.message = 'Đã Pause; không cấp Group claim/account lease mới. Tác vụ đang chạy sẽ kết thúc an toàn rồi nhả lease.'
    if (session.inFlightCount === 0 && (session.run.run.status === 'running' || session.run.run.status === 'created')) {
      session.run = this.runs.pause(session.runId)
    }
    return snapshotSession(session)
  }

  resume(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    const existing = this.session?.pageTabId === payload.pageTabId ? this.session : null
    const session = existing ?? this.restoreSession(payload.pageTabId)
    const restored = existing === null
    if (session.run.run.status === 'stopped') throw new Error('Page Tab đã Stop; hãy bấm Bắt đầu để tạo run mới từ Group gốc.')

    session.manualPaused = false
    session.stopRequested = false
    session.disposed = false
    session.message = restored ? 'Đã khôi phục snapshot sau khi khởi động lại ứng dụng.' : 'Đang tiếp tục rolling pool hiện tại.'
    if (restored) this.attach(session)
    return snapshotSession(session)
  }

  stop(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    const session = this.requireSession(payload.pageTabId)
    if (session.status === 'stopped') return snapshotSession(session)
    session.stopRequested = true
    session.manualPaused = false
    session.nextActionAt = null
    if (session.inFlightCount > 0) {
      session.status = 'stopping'
      session.message = 'Đang Stop; chờ các tác vụ đang chạy nhả claim/lease rồi dừng run.'
    } else {
      this.finalizeStop(session)
    }
    return snapshotSession(session)
  }

  waitForSettled(): Promise<void> {
    return this.cyclePromise
  }

  dispose(): void {
    const session = this.session
    if (!session) return
    session.disposed = true
    this.settleCycle()
    if (session.inFlightCount === 0 && (session.run.run.status === 'running' || session.run.run.status === 'created')) {
      try { session.run = this.runs.pause(session.runId) } catch { /* shutdown */ }
    }
  }

  private attach(session: ParallelRotationSession): void {
    this.session = session
    this.beginCycleWait()
    void this.runLoop(session).catch((cause) => {
      if (session.disposed) return
      if (session.stopRequested && session.inFlightCount === 0) {
        try { this.finalizeStop(session); return } catch { /* expose original */ }
      }
      session.status = 'error'
      session.message = cause instanceof Error ? cause.message : String(cause)
      session.nextActionAt = null
      this.settleCycle()
      try {
        if (session.run.run.status === 'running') session.run = this.runs.pause(session.runId)
      } catch { /* keep original error */ }
    })
  }

  private beginCycleWait(): void {
    this.cyclePromise = new Promise<void>((resolve) => { this.resolveCycle = resolve })
  }

  private settleCycle(): void {
    const resolve = this.resolveCycle
    this.resolveCycle = null
    resolve?.()
  }

  private requireSession(pageTabId: number): ParallelRotationSession {
    if (!this.session || this.session.pageTabId !== pageTabId) throw new Error(`Page Tab #${pageTabId} chưa có vòng chạy tài khoản đang hoạt động.`)
    return this.session
  }

  private restoreSession(pageTabId: number): ParallelRotationSession {
    const run = this.runs.getLatestForPageTab(pageTabId)
    if (!run) throw new Error(`Page Tab #${pageTabId} chưa có phiên chạy để tiếp tục.`)
    if (run.run.status === 'stopped' || run.run.status === 'failed') throw new Error('Phiên đã kết thúc; hãy bấm Bắt đầu để tạo run mới.')
    const state = this.runs.getRotationState?.(run.run.id) ?? { activeDateKey: startedDateKey(run), completedWindowKey: null }
    return {
      pageTabId,
      runId: run.run.id,
      status: run.run.status === 'completed' ? 'completed' : 'paused',
      currentAccountId: null,
      currentAccountIndex: null,
      slotsCompletedThisTurn: 0,
      targetSlotsThisTurn: 0,
      cycle: 0,
      nextActionAt: null,
      message: 'Đã tìm thấy phiên chạy trước đó; sẵn sàng khôi phục.',
      lastResult: null,
      run,
      manualPaused: false,
      stopRequested: false,
      inFlightCount: 0,
      activeDateKey: state.activeDateKey,
      activeWindowKey: null,
      completedWindowKey: state.completedWindowKey,
      disposed: false,
      turns: []
    }
  }

  private schedulesFor(session: ParallelRotationSession): PageTabScheduleInput[] {
    return this.getLiveSchedules(session.pageTabId) ?? session.run.run.snapshot.schedules
  }

  private concurrency(run: RunDetails): number {
    const enabled = Math.max(1, sortedEnabledAccounts(run).length)
    const configured = run.run.snapshot.rotation.accountConcurrency ?? 1
    return Math.max(1, Math.min(enabled, Math.floor(configured)))
  }

  private tryAcquire(accountId: number): RollingPoolLease | null {
    return this.accountExecution ? this.accountExecution.tryAcquireLease(accountId) : noOpLease
  }

  private buildTurns(run: RunDetails): ParallelTurn[] {
    return accountsForNewCycle(run, this.clock.random).map((account, index) => ({
      account,
      index,
      targetSlots: account.postsPerTurn ?? run.run.snapshot.rotation.postsPerAccount,
      completedSlots: 0,
      done: false,
      unavailable: false,
      usedSlot: false,
      leaveAccountEarly: false
    }))
  }

  private async runLoop(session: ParallelRotationSession): Promise<void> {
    while (!session.disposed) {
      if (!await this.waitUntilRunnable(session)) return
      if (session.stopRequested) { if (session.inFlightCount === 0) this.finalizeStop(session); return }

      const current = this.runs.get(session.runId)
      if (!current) throw new Error(`Không tìm thấy phiên #${session.runId}.`)
      session.run = current
      if (isRunExhausted(current)) {
        this.refillGroupRun(session, 'Group đã cạn; tạo vòng Group mới từ danh sách gốc.')
        continue
      }

      if (!session.turns.length) session.turns = this.buildTurns(current)
      const pendingTurns = session.turns.filter((turn) => !turn.done)
      if (!pendingTurns.length) {
        this.completeAccountCycle(session)
        continue
      }

      await runRollingAccountPool({
        items: pendingTurns,
        concurrency: this.concurrency(session.run),
        tryAcquire: (turn) => this.tryAcquire(turn.account.accountId),
        waitUntilRunnable: () => this.waitUntilRunnable(session),
        shouldStop: () => session.disposed || session.stopRequested,
        run: async (turn) => this.runTurn(session, turn),
        afterRelease: async (turn, context) => {
          if (!turn.done || !turn.usedSlot || session.manualPaused || session.stopRequested || context.remainingItems <= 0) return
          const rotation = session.run.run.snapshot.rotation
          await this.waitConfiguredDelay(session, rotation.accountDelayMinSeconds, rotation.accountDelayMaxSeconds, 'Chờ đổi tài khoản')
        },
        idleDelayMs: 50
      })

      if (session.stopRequested) { if (session.inFlightCount === 0) this.finalizeStop(session); return }
      if (session.manualPaused) continue

      const remainingTurns = session.turns.filter((turn) => !turn.done)
      if (!remainingTurns.length) {
        this.completeAccountCycle(session)
        continue
      }
      if (session.turns.every((turn) => turn.done && turn.unavailable)) {
        session.manualPaused = true
        session.status = 'paused'
        session.message = 'Không còn tài khoản khả dụng trong vòng hiện tại. Đã tạm dừng để người vận hành xử lý.'
        if (session.run.run.status === 'running') session.run = this.runs.pause(session.runId)
        continue
      }

      // No pending item can temporarily mean every remaining Group is already claimed
      // by another active account. Yield before trying the incomplete turns again.
      await this.clock.sleep(50)
    }
  }

  private async runTurn(session: ParallelRotationSession, turn: ParallelTurn): Promise<void> {
    const accountId = turn.account.accountId
    try {
      while (!turn.done && turn.completedSlots < turn.targetSlots && !session.disposed) {
        if (session.manualPaused || session.stopRequested) return
        if (!await this.waitUntilRunnable(session)) return
        if (session.manualPaused || session.stopRequested) return

        let current = this.runs.get(session.runId)
        if (!current) throw new Error(`Không tìm thấy phiên #${session.runId}.`)
        session.run = current
        if (current.metrics.pending === 0) {
          if (current.metrics.processing > 0) return
          if (isRunExhausted(current)) {
            this.refillGroupRun(session, `Tài khoản #${accountId}: Group đã cạn; tạo vòng Group mới từ danh sách gốc.`)
            current = session.run
          }
        }

        session.currentAccountId = accountId
        session.currentAccountIndex = turn.index
        session.slotsCompletedThisTurn = turn.completedSlots
        session.targetSlotsThisTurn = turn.targetSlots
        session.message = `Tài khoản #${accountId}: ${turn.completedSlots}/${turn.targetSlots} bài trong rolling pool.`
        session.inFlightCount += 1
        let result: ExecuteSinglePostingJobResult
        try {
          result = await this.posting.executeSingle({ runId: session.runId, accountId })
        } finally {
          session.inFlightCount = Math.max(0, session.inFlightCount - 1)
        }

        session.run = result.run
        session.lastResult = result.result
        const sessionDecision = resolveSessionFailureDecision(result.result, this.getSessionSettings())
        const networkDecision = resolveNetworkFailureDecision(result.result, this.getNetworkSettings())

        if (session.stopRequested) return
        if (result.item === null) {
          if (result.result.code === 'no_pending_item') {
            if (result.run.metrics.processing > 0) return
            if (isRunExhausted(result.run)) {
              this.refillGroupRun(session, `Tài khoản #${accountId}: Group đã cạn; tạo vòng Group mới.`)
              continue
            }
          }
          if (networkDecision?.action === 'pause_tab') {
            this.pauseForNetworkFailure(session, accountId)
            return
          }
          if (networkDecision?.action === 'switch_account' || isAccountUnavailable(result)) {
            turn.unavailable = true
            turn.leaveAccountEarly = true
            turn.done = true
            session.message = `Tài khoản #${accountId} không khả dụng; nhả slot và chuyển account khác.`
            return
          }
          if (sessionDecision?.action === 'stop') {
            this.pauseForSessionFailure(session, accountId, sessionDecision.kind)
            return
          }
          turn.leaveAccountEarly = true
          turn.done = true
          return
        }

        if (sessionDecision) {
          if (sessionDecision.action === 'stop') {
            this.pauseForSessionFailure(session, accountId, sessionDecision.kind)
            return
          }
          turn.unavailable = true
          turn.leaveAccountEarly = true
          turn.done = true
          return
        }

        if (result.result.status === 'skipped') continue
        if (result.result.status !== 'success') {
          turn.leaveAccountEarly = true
          turn.done = true
          session.message = `Tài khoản #${accountId}: bài chưa thành công (${result.result.code ?? result.result.status}); nhả slot.`
          return
        }

        turn.usedSlot = true
        turn.completedSlots += 1
        session.slotsCompletedThisTurn = turn.completedSlots
        if (turn.completedSlots >= turn.targetSlots) {
          turn.done = true
          return
        }

        const rotation = session.run.run.snapshot.rotation
        if (!await this.waitConfiguredDelay(session, rotation.postDelayMinSeconds, rotation.postDelayMaxSeconds, 'Chờ giữa các bài')) return
      }
      if (turn.completedSlots >= turn.targetSlots) turn.done = true
    } finally {
      if (this.posting.releaseAccount) await this.posting.releaseAccount(accountId)
      if (session.currentAccountId === accountId) {
        session.currentAccountId = null
        session.currentAccountIndex = null
      }
    }
  }

  private completeAccountCycle(session: ParallelRotationSession): void {
    session.cycle += 1
    session.completedWindowKey = session.activeWindowKey
    this.persistRotationState(session)
    session.turns = []
    session.currentAccountId = null
    session.currentAccountIndex = null
    session.slotsCompletedThisTurn = 0
    session.targetSlotsThisTurn = 0
    const next = nextScheduleWindowStart(this.schedulesFor(session), this.clock.now())
    if (session.run.run.status === 'running' || session.run.run.status === 'created') session.run = this.runs.pause(session.runId)
    session.status = 'waiting_window'
    session.nextActionAt = next.getTime()
    session.message = `Khung giờ đã chạy đủ một vòng tài khoản song song; chờ khung tiếp theo ${next.toLocaleString()}.`
    this.settleCycle()
  }

  private async waitUntilRunnable(session: ParallelRotationSession): Promise<boolean> {
    while (!session.disposed) {
      if (session.stopRequested) return false
      if (session.manualPaused) {
        session.status = 'paused'
        session.nextActionAt = null
        if (session.inFlightCount === 0 && (session.run.run.status === 'running' || session.run.run.status === 'created')) {
          session.run = this.runs.pause(session.runId)
        }
        await this.clock.sleep(100)
        continue
      }

      const now = this.clock.now()
      const schedules = this.schedulesFor(session)
      const todayKey = localDateKey(now)
      const windowKey = scheduleWindowKey(schedules, now)
      if (!windowKey) {
        if (session.inFlightCount === 0 && (session.run.run.status === 'running' || session.run.run.status === 'created')) session.run = this.runs.pause(session.runId)
        const next = nextScheduleStart(schedules, now)
        session.status = 'waiting_window'
        session.nextActionAt = next?.getTime() ?? null
        session.message = next ? `Ngoài khung giờ chạy; chờ đến ${next.toLocaleString()}.` : 'Ngoài khung giờ chạy.'
        await this.clock.sleep(next ? Math.max(100, Math.min(30_000, next.getTime() - now.getTime())) : 30_000)
        continue
      }

      if (session.activeDateKey !== null && session.activeDateKey !== todayKey) this.rolloverForDay(session, todayKey)
      else if (session.activeDateKey === null) { session.activeDateKey = todayKey; this.persistRotationState(session) }

      if (session.completedWindowKey === windowKey) {
        const next = nextScheduleWindowStart(schedules, now)
        session.status = 'waiting_window'
        session.nextActionAt = next.getTime()
        await this.clock.sleep(Math.max(100, Math.min(30_000, next.getTime() - now.getTime())))
        continue
      }
      if (session.completedWindowKey && session.completedWindowKey !== windowKey) {
        session.completedWindowKey = null
        this.persistRotationState(session)
      }

      session.activeWindowKey = windowKey
      if (isRunExhausted(session.run)) this.refillGroupRun(session, 'Group đã cạn; tạo vòng Group mới từ danh sách gốc cho khung giờ hiện tại.')
      if (session.run.run.status !== 'running') session.run = this.runs.resume(session.runId)
      session.status = 'running'
      session.nextActionAt = null
      return true
    }
    return false
  }

  private refillGroupRun(session: ParallelRotationSession, message: string): void {
    const current = this.runs.get(session.runId)
    if (current && !isRunExhausted(current)) { session.run = current; return }
    const latest = this.runs.getLatestForPageTab(session.pageTabId)
    if (latest && latest.run.id !== session.runId && !['completed', 'stopped', 'failed'].includes(latest.run.status)) {
      session.run = latest
      session.runId = latest.run.id
      session.message = message
      return
    }
    const fresh = this.runs.createForPageTab(session.pageTabId)
    session.run = fresh
    session.runId = fresh.run.id
    session.message = message
    this.persistRotationState(session)
  }

  private rolloverForDay(session: ParallelRotationSession, dateKey: string): void {
    if (session.inFlightCount > 0) return
    if (session.run.run.status === 'created' || session.run.run.status === 'running' || session.run.run.status === 'paused') {
      session.run = this.runs.stop(session.runId, 'daily_rollover')
    }
    const fresh = this.runs.createForPageTab(session.pageTabId)
    session.run = fresh
    session.runId = fresh.run.id
    session.activeDateKey = dateKey
    session.activeWindowKey = null
    session.completedWindowKey = null
    session.turns = []
    session.cycle = 0
    session.lastResult = null
    this.persistRotationState(session)
  }

  private finalizeStop(session: ParallelRotationSession): void {
    if (session.inFlightCount > 0) return
    if (session.run.run.status !== 'stopped') session.run = this.runs.stop(session.runId, 'manual')
    session.status = 'stopped'
    session.stopRequested = false
    session.disposed = true
    session.turns = []
    session.currentAccountId = null
    session.currentAccountIndex = null
    session.activeWindowKey = null
    session.completedWindowKey = null
    session.nextActionAt = null
    session.message = 'Đã Stop Page Tab; mọi claim còn treo đã được release trong run hiện tại.'
    this.settleCycle()
  }

  private persistRotationState(session: ParallelRotationSession): void {
    this.runs.saveRotationState?.(session.runId, {
      activeDateKey: session.activeDateKey,
      completedWindowKey: session.completedWindowKey
    })
  }

  private pauseForSessionFailure(session: ParallelRotationSession, accountId: number, kind: 'session_expired' | 'checkpoint'): void {
    session.manualPaused = true
    session.status = 'paused'
    session.nextActionAt = null
    session.message = kind === 'checkpoint'
      ? `Tài khoản #${accountId} cần checkpoint/xác minh thủ công. Đã Pause Page Tab.`
      : `Tài khoản #${accountId} cần đăng nhập lại. Đã Pause Page Tab.`
  }

  private pauseForNetworkFailure(session: ParallelRotationSession, accountId: number): void {
    session.manualPaused = true
    session.status = 'paused'
    session.nextActionAt = null
    session.message = `Proxy của tài khoản #${accountId} không sẵn sàng. Đã Pause Page Tab.`
  }

  private async waitConfiguredDelay(
    session: ParallelRotationSession,
    minSeconds: number,
    maxSeconds: number,
    label: string
  ): Promise<boolean> {
    const expectedRunId = session.runId
    let remainingMs = randomDelaySeconds(minSeconds, maxSeconds, this.clock.random) * 1000
    if (remainingMs <= 0) return true
    session.message = `${label}: ${Math.ceil(remainingMs / 1000)}s.`
    while (remainingMs > 0 && !session.disposed && !session.stopRequested && !session.manualPaused) {
      const chunk = Math.min(1000, remainingMs)
      session.nextActionAt = this.clock.now().getTime() + remainingMs
      await this.clock.sleep(chunk)
      remainingMs -= chunk
    }
    session.nextActionAt = null
    return !session.disposed && !session.stopRequested && !session.manualPaused && session.runId === expectedRunId
  }
}
