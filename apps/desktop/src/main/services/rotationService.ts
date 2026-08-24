import { DEFAULT_APP_SETTINGS, type NetworkSettings, type SessionSettings } from '../../shared/appSettings'
import type { PageTabScheduleInput } from '../../shared/pageTabs'
import type { ExecuteSinglePostingJobPayload, ExecuteSinglePostingJobResult } from '../../shared/posting'
import type { RotationPageTabPayload, RotationRuntimeSnapshot, RotationRuntimeStatus } from '../../shared/rotation'
import type { RunDetails, RunSnapshotAccount } from '../../shared/runs'
import { resolveNetworkFailureDecision } from './networkFailurePolicy'
import { isWithinSchedule, nextScheduleStart, nextScheduleStartAfterDay, randomDelaySeconds } from './rotationSchedule'
import { resolveSessionFailureDecision } from './sessionFailurePolicy'

export type RunStopReason = 'manual' | 'daily_rollover'

export interface RotationRunStore {
  getLatestForPageTab(pageTabId: number): RunDetails | null
  createForPageTab(pageTabId: number): RunDetails
  get(runId: number): RunDetails | null
  pause(runId: number): RunDetails
  resume(runId: number): RunDetails
  stop(runId: number, reason?: RunStopReason): RunDetails
}

export interface RotationPostingExecutor {
  executeSingle(payload: ExecuteSinglePostingJobPayload): Promise<ExecuteSinglePostingJobResult>
  releaseAccount?: (accountId: number) => Promise<void>
}

interface RotationClock {
  now: () => Date
  random: () => number
  sleep: (milliseconds: number) => Promise<void>
}

interface RotationSession {
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
  inFlight: boolean
  activeDateKey: string | null
  disposed: boolean
}

const defaultClock: RotationClock = {
  now: () => new Date(),
  random: () => Math.random(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function sortedEnabledAccounts(run: RunDetails): RunSnapshotAccount[] {
  return run.run.snapshot.accounts
    .filter((account) => account.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

function isAccountUnavailable(result: ExecuteSinglePostingJobResult): boolean {
  return result.item === null && (
    result.result.code === 'needs_login' ||
    result.result.code === 'verification_required' ||
    result.result.code === 'account_disabled' ||
    result.result.code === 'no_enabled_account'
  )
}

function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

function startedDateKey(run: RunDetails): string | null {
  return run.run.startedAt === null ? null : localDateKey(new Date(run.run.startedAt))
}

function isRunExhausted(run: RunDetails): boolean {
  return run.run.status === 'completed' || run.metrics.remaining === 0
}

function snapshotSession(session: RotationSession): RotationRuntimeSnapshot {
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

export class RotationService {
  private session: RotationSession | null = null
  private loopPromise: Promise<void> | null = null
  private cyclePromise: Promise<void> | null = null
  private resolveCycle: (() => void) | null = null

  constructor(
    private readonly runs: RotationRunStore,
    private readonly posting: RotationPostingExecutor,
    private readonly clock: RotationClock = defaultClock,
    private readonly getSessionSettings: () => SessionSettings = () => ({ ...DEFAULT_APP_SETTINGS.session }),
    private readonly getNetworkSettings: () => NetworkSettings = () => ({ ...DEFAULT_APP_SETTINGS.network }),
    private readonly getLiveSchedules: (pageTabId: number) => PageTabScheduleInput[] | null = () => null
  ) {}

  start(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    const existing = this.session
    if (existing && !['completed', 'error', 'stopped'].includes(existing.status)) {
      if (existing.pageTabId === payload.pageTabId) return snapshotSession(existing)
      throw new Error(`Page Tab #${existing.pageTabId} đang hoạt động trong bộ điều phối tài khoản.`)
    }

    let run = this.runs.getLatestForPageTab(payload.pageTabId)
    if (!run || ['completed', 'stopped', 'failed'].includes(run.run.status)) {
      run = this.runs.createForPageTab(payload.pageTabId)
    } else if (run.run.status === 'running') {
      throw new Error(`Phiên #${run.run.id} đang chạy ngoài bộ điều phối tài khoản. Hãy tạm dừng phiên trước khi bắt đầu.`)
    }

    const accounts = sortedEnabledAccounts(run)
    if (accounts.length === 0) throw new Error('Page Tab không có tài khoản được bật để chạy.')

    const session: RotationSession = {
      pageTabId: payload.pageTabId,
      runId: run.run.id,
      status: 'starting',
      currentAccountId: null,
      currentAccountIndex: null,
      slotsCompletedThisTurn: 0,
      targetSlotsThisTurn: 0,
      cycle: 0,
      nextActionAt: null,
      message: 'Đang khởi động vòng chạy tài khoản.',
      lastResult: null,
      run,
      manualPaused: false,
      stopRequested: false,
      inFlight: false,
      activeDateKey: startedDateKey(run),
      disposed: false
    }

    this.attachSession(session)
    return snapshotSession(session)
  }

  status(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    if (this.session?.pageTabId === payload.pageTabId) return snapshotSession(this.session)
    const run = this.runs.getLatestForPageTab(payload.pageTabId)
    const runStatus = run?.run.status
    return {
      pageTabId: payload.pageTabId,
      runId: run?.run.id ?? null,
      status: runStatus === 'completed'
        ? 'completed'
        : runStatus === 'paused'
          ? 'paused'
          : runStatus === 'stopped'
            ? 'stopped'
            : 'idle',
      currentAccountId: null,
      currentAccountIndex: null,
      slotsCompletedThisTurn: 0,
      targetSlotsThisTurn: 0,
      cycle: 0,
      nextActionAt: null,
      message: runStatus === 'running'
        ? `Phiên #${run?.run.id} đang chạy ngoài bộ điều phối tài khoản.`
        : runStatus === 'stopped'
          ? 'Page Tab đã Stop. Bấm Bắt đầu để tạo run mới từ Group gốc.'
          : null,
      lastResult: null,
      run
    }
  }

  pause(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    const session = this.requireSession(payload.pageTabId)
    if (['completed', 'error', 'stopping', 'stopped'].includes(session.status)) return snapshotSession(session)
    session.manualPaused = true
    session.status = 'paused'
    session.message = 'Đã tạm dừng thủ công; tiến độ run hiện tại được giữ nguyên để Tiếp tục sau.'
    session.nextActionAt = null
    if (!session.inFlight && (session.run.run.status === 'running' || session.run.run.status === 'created')) {
      session.run = this.runs.pause(session.runId)
    }
    return snapshotSession(session)
  }

  resume(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    const existing = this.session?.pageTabId === payload.pageTabId ? this.session : null
    const session = existing ?? this.restoreSession(payload.pageTabId)
    const restoredAfterRestart = existing === null

    if (session.status === 'completed') {
      if (restoredAfterRestart) this.session = session
      return snapshotSession(session)
    }
    if (session.status === 'stopped' || session.run.run.status === 'stopped') {
      throw new Error('Page Tab đã Stop; hãy bấm Bắt đầu để tạo run mới từ Group gốc.')
    }
    if (session.status === 'error') throw new Error('Vòng chạy đang lỗi; hãy bắt đầu lại sau khi xử lý nguyên nhân.')

    session.manualPaused = false
    session.stopRequested = false
    session.disposed = false
    session.message = restoredAfterRestart
      ? 'Đã khôi phục phiên chạy sau khi khởi động lại ứng dụng.'
      : 'Đang tiếp tục run hiện tại.'

    const now = this.clock.now()
    const schedules = this.schedulesFor(session)
    const todayKey = localDateKey(now)
    if (isWithinSchedule(schedules, now)) {
      if (session.activeDateKey !== null && session.activeDateKey !== todayKey) {
        this.rolloverForDay(session, todayKey)
      } else if (session.activeDateKey === null) {
        session.activeDateKey = todayKey
      }

      if (isRunExhausted(session.run)) {
        session.status = 'waiting_window'
        session.nextActionAt = nextScheduleStartAfterDay(schedules, now).getTime()
      } else {
        if (session.run.run.status !== 'running') session.run = this.runs.resume(session.runId)
        session.status = 'running'
        session.nextActionAt = null
      }
    } else {
      if (!session.inFlight && (session.run.run.status === 'running' || session.run.run.status === 'created')) {
        session.run = this.runs.pause(session.runId)
      }
      session.status = 'waiting_window'
      session.nextActionAt = nextScheduleStart(schedules, now)?.getTime() ?? null
    }

    if (restoredAfterRestart) this.attachSession(session)
    return snapshotSession(session)
  }

  stop(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    const session = this.requireSession(payload.pageTabId)
    if (session.status === 'stopped') return snapshotSession(session)

    session.stopRequested = true
    session.manualPaused = false
    session.nextActionAt = null
    if (session.inFlight) {
      session.status = 'stopping'
      session.message = 'Đang Stop; chờ tác vụ hiện tại kết thúc an toàn rồi dừng run.'
      return snapshotSession(session)
    }

    this.finalizeStop(session)
    return snapshotSession(session)
  }

  async waitForSettled(): Promise<void> {
    await this.cyclePromise
  }

  dispose(): void {
    if (!this.session) return
    this.session.disposed = true
    this.settleCycle()
    if (!this.session.inFlight && (this.session.run.run.status === 'running' || this.session.run.run.status === 'created')) {
      try {
        this.session.run = this.runs.pause(this.session.runId)
      } catch {
        // Shutdown should continue even when DB state already changed.
      }
    }
  }

  private beginCycleWait(): void {
    this.cyclePromise = new Promise<void>((resolve) => {
      this.resolveCycle = resolve
    })
  }

  private settleCycle(): void {
    const resolve = this.resolveCycle
    this.resolveCycle = null
    resolve?.()
  }

  private attachSession(session: RotationSession): void {
    this.session = session
    this.beginCycleWait()
    this.loopPromise = this.runLoop(session).catch((cause) => {
      if (session.disposed) return
      if (session.stopRequested) {
        try {
          this.finalizeStop(session)
          return
        } catch {
          // Fall through and keep the original runtime error visible.
        }
      }
      this.settleCycle()
      session.status = 'error'
      session.message = cause instanceof Error ? cause.message : String(cause)
      session.nextActionAt = null
      try {
        if (session.run.run.status === 'running') session.run = this.runs.pause(session.runId)
      } catch {
        // Keep the original runtime error visible.
      }
    })
  }

  private restoreSession(pageTabId: number): RotationSession {
    const run = this.runs.getLatestForPageTab(pageTabId)
    if (!run) {
      throw new Error(`Page Tab #${pageTabId} chưa có phiên chạy để tiếp tục. Hãy bấm Bắt đầu để tạo phiên mới.`)
    }
    if (run.run.status === 'stopped' || run.run.status === 'failed') {
      throw new Error(`Phiên #${run.run.id} đã ${run.run.status === 'stopped' ? 'dừng' : 'thất bại'}; hãy bấm Bắt đầu để tạo phiên mới.`)
    }

    const accounts = sortedEnabledAccounts(run)
    if (accounts.length === 0) throw new Error('Page Tab không có tài khoản được bật để tiếp tục.')

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
      message: run.run.status === 'completed'
        ? 'Phiên chạy đã hoàn tất.'
        : 'Đã tìm thấy phiên chạy trước đó; sẵn sàng khôi phục.',
      lastResult: null,
      run,
      manualPaused: true,
      stopRequested: false,
      inFlight: false,
      activeDateKey: startedDateKey(run),
      disposed: false
    }
  }

  private requireSession(pageTabId: number): RotationSession {
    if (!this.session || this.session.pageTabId !== pageTabId) {
      throw new Error(`Page Tab #${pageTabId} chưa có vòng chạy tài khoản đang hoạt động.`)
    }
    return this.session
  }

  private schedulesFor(session: RotationSession): PageTabScheduleInput[] {
    return this.getLiveSchedules(session.pageTabId) ?? session.run.run.snapshot.schedules
  }

  private async releaseAccountTurn(accountId: number): Promise<void> {
    if (!this.posting.releaseAccount) return
    await this.posting.releaseAccount(accountId)
  }

  private async releaseIdleCurrentAccount(session: RotationSession): Promise<void> {
    if (session.inFlight || session.currentAccountId === null) return
    await this.releaseAccountTurn(session.currentAccountId)
  }

  private finalizeStop(session: RotationSession): void {
    if (session.run.run.status !== 'stopped') {
      session.run = this.runs.stop(session.runId, 'manual')
    }
    session.status = 'stopped'
    session.stopRequested = false
    session.manualPaused = false
    session.disposed = true
    session.currentAccountId = null
    session.currentAccountIndex = null
    session.nextActionAt = null
    session.message = 'Đã Stop Page Tab. Lần Bắt đầu tiếp theo sẽ tạo run mới từ Group gốc.'
    this.settleCycle()
  }

  private rolloverForDay(session: RotationSession, dateKey: string): void {
    if (session.activeDateKey === dateKey) return
    if (session.run.run.status === 'created' || session.run.run.status === 'running' || session.run.run.status === 'paused') {
      session.run = this.runs.stop(session.runId, 'daily_rollover')
    }

    const fresh = this.runs.createForPageTab(session.pageTabId)
    if (sortedEnabledAccounts(fresh).length === 0) {
      throw new Error('Page Tab không có tài khoản được bật cho ngày chạy mới.')
    }

    session.run = fresh
    session.runId = fresh.run.id
    session.activeDateKey = dateKey
    session.currentAccountId = null
    session.currentAccountIndex = null
    session.slotsCompletedThisTurn = 0
    session.targetSlotsThisTurn = 0
    session.cycle = 0
    session.nextActionAt = null
    session.lastResult = null
    session.status = 'starting'
    session.message = 'Đã sang ngày chạy mới; tạo run mới từ Group gốc.'
    this.beginCycleWait()
  }

  private pauseForSessionFailure(session: RotationSession, accountId: number, kind: 'session_expired' | 'checkpoint'): void {
    session.manualPaused = true
    session.status = 'paused'
    session.nextActionAt = null
    session.message = kind === 'checkpoint'
      ? `Tài khoản #${accountId} cần checkpoint/xác minh thủ công. Đã tạm dừng Page Tab theo chính sách.`
      : `Tài khoản #${accountId} chưa thể tự phục hồi đăng nhập. Đã tạm dừng Page Tab theo chính sách.`
    if (session.run.run.status === 'running' || session.run.run.status === 'created') {
      session.run = this.runs.pause(session.runId)
    }
  }

  private pauseForNetworkFailure(session: RotationSession, accountId: number): void {
    session.manualPaused = true
    session.status = 'paused'
    session.nextActionAt = null
    session.message = `Proxy của tài khoản #${accountId} không sẵn sàng. Đã tạm dừng Page Tab theo chính sách mạng.`
    if (session.run.run.status === 'running' || session.run.run.status === 'created') {
      session.run = this.runs.pause(session.runId)
    }
  }

  private async runLoop(session: RotationSession): Promise<void> {
    let accountIndex = 0
    let unavailableStreak = 0

    runLoop: while (!session.disposed) {
      const runIdBeforeWait = session.runId
      const ready = await this.waitUntilRunnable(session)
      if (!ready) return
      if (session.runId !== runIdBeforeWait) {
        accountIndex = 0
        unavailableStreak = 0
      }

      const current = this.runs.get(session.runId)
      if (!current) throw new Error(`Không tìm thấy phiên #${session.runId}.`)
      session.run = current
      if (isRunExhausted(current)) continue

      const accounts = sortedEnabledAccounts(current)
      if (accounts.length === 0) throw new Error('Page Tab không còn tài khoản được bật để chạy.')
      if (accountIndex >= accounts.length) accountIndex = 0

      const account = accounts[accountIndex]
      if (!account) throw new Error('Không tìm thấy tài khoản tại vị trí hiện tại trong vòng chạy.')
      const targetSlots = account.postsPerTurn ?? current.run.snapshot.rotation.postsPerAccount
      session.currentAccountId = account.accountId
      session.currentAccountIndex = accountIndex
      session.slotsCompletedThisTurn = 0
      session.targetSlotsThisTurn = targetSlots
      session.message = `Tài khoản #${account.accountId}: lượt ${targetSlots} bài.`

      let usedSlot = false
      let leaveAccountEarly = false
      try {
        while (session.slotsCompletedThisTurn < targetSlots && !session.disposed) {
          const activeRunId = session.runId
          const canPost = await this.waitUntilRunnable(session)
          if (!canPost) return
          if (session.runId !== activeRunId) {
            accountIndex = 0
            unavailableStreak = 0
            continue runLoop
          }

          session.inFlight = true
          let result: ExecuteSinglePostingJobResult
          try {
            result = await this.posting.executeSingle({ runId: session.runId, accountId: account.accountId })
          } finally {
            session.inFlight = false
          }
          session.run = result.run
          session.lastResult = result.result

          if (session.stopRequested) {
            this.finalizeStop(session)
            return
          }

          const sessionDecision = resolveSessionFailureDecision(result.result, this.getSessionSettings())
          const networkDecision = resolveNetworkFailureDecision(result.result, this.getNetworkSettings())

          if (result.item === null) {
            if (networkDecision?.action === 'pause_tab') {
              this.pauseForNetworkFailure(session, account.accountId)
              leaveAccountEarly = true
              break
            }
            if (networkDecision?.action === 'switch_account') {
              session.message = `Proxy của tài khoản #${account.accountId} lỗi; chuyển sang tài khoản kế tiếp theo chính sách mạng.`
              leaveAccountEarly = true
              break
            }
            if (sessionDecision?.action === 'stop') {
              this.pauseForSessionFailure(session, account.accountId, sessionDecision.kind)
              leaveAccountEarly = true
              break
            }
            if (result.result.code === 'no_pending_item' || isRunExhausted(result.run)) {
              this.settleCycle()
              continue runLoop
            }
            if (isAccountUnavailable(result)) {
              leaveAccountEarly = true
              if (sessionDecision) {
                session.message = `Tài khoản #${account.accountId} chưa thể đăng nhập/xác minh; chuyển sang tài khoản kế tiếp theo chính sách.`
              }
              break
            }
            leaveAccountEarly = true
            break
          }

          usedSlot = true
          unavailableStreak = 0
          session.slotsCompletedThisTurn += 1

          if (isRunExhausted(result.run)) {
            this.settleCycle()
            continue runLoop
          }

          if (sessionDecision) {
            leaveAccountEarly = true
            if (sessionDecision.action === 'stop') {
              this.pauseForSessionFailure(session, account.accountId, sessionDecision.kind)
            } else {
              session.message = `Tài khoản #${account.accountId} chưa thể đăng nhập/xác minh; chuyển sang tài khoản kế tiếp theo chính sách.`
            }
            break
          }

          if (session.slotsCompletedThisTurn < targetSlots) {
            const sameRun = await this.waitConfiguredDelay(
              session,
              current.run.snapshot.rotation.postDelayMinSeconds,
              current.run.snapshot.rotation.postDelayMaxSeconds,
              'Chờ giữa các bài'
            )
            if (!sameRun) continue runLoop
          }
        }
      } finally {
        await this.releaseAccountTurn(account.accountId)
      }

      if (session.stopRequested) {
        this.finalizeStop(session)
        return
      }
      if (session.manualPaused) continue

      if (!usedSlot) unavailableStreak += 1
      if (unavailableStreak >= accounts.length) {
        session.manualPaused = true
        session.status = 'paused'
        session.message = 'Không còn tài khoản khả dụng trong vòng hiện tại. Đã tạm dừng để người vận hành xử lý.'
        session.nextActionAt = null
        if (session.run.run.status === 'running' || session.run.run.status === 'created') {
          session.run = this.runs.pause(session.runId)
        }
        unavailableStreak = 0
        continue
      }

      const previousIndex = accountIndex
      accountIndex = (accountIndex + 1) % accounts.length
      if (accountIndex === 0 && previousIndex === accounts.length - 1) session.cycle += 1

      if (!leaveAccountEarly && session.run.metrics.remaining > 0) {
        const rotation = session.run.run.snapshot.rotation
        const sameRun = accounts.length > 1
          ? await this.waitConfiguredDelay(
              session,
              rotation.accountDelayMinSeconds,
              rotation.accountDelayMaxSeconds,
              'Chờ đổi tài khoản'
            )
          : await this.waitConfiguredDelay(
              session,
              rotation.postDelayMinSeconds,
              rotation.postDelayMaxSeconds,
              'Chờ giữa các bài'
            )
        if (!sameRun) {
          accountIndex = 0
          unavailableStreak = 0
          continue
        }
      }
    }
  }

  private async waitUntilRunnable(session: RotationSession): Promise<boolean> {
    while (!session.disposed) {
      if (session.stopRequested && !session.inFlight) {
        await this.releaseIdleCurrentAccount(session)
        this.finalizeStop(session)
        return false
      }

      if (session.manualPaused) {
        await this.releaseIdleCurrentAccount(session)
        session.status = 'paused'
        session.nextActionAt = null
        if (!session.inFlight && (session.run.run.status === 'running' || session.run.run.status === 'created')) {
          session.run = this.runs.pause(session.runId)
        }
        await this.clock.sleep(250)
        continue
      }

      const now = this.clock.now()
      const schedules = this.schedulesFor(session)
      const todayKey = localDateKey(now)

      if (isRunExhausted(session.run) && session.activeDateKey === todayKey) {
        await this.releaseIdleCurrentAccount(session)
        this.settleCycle()
        const next = nextScheduleStartAfterDay(schedules, now)
        session.status = 'waiting_window'
        session.nextActionAt = next.getTime()
        session.message = `Phiên hôm nay đã xong; chờ ngày chạy kế tiếp ${next.toLocaleString()}.`
        const waitMs = Math.max(250, Math.min(30_000, next.getTime() - now.getTime()))
        await this.clock.sleep(waitMs)
        continue
      }

      if (!isWithinSchedule(schedules, now)) {
        await this.releaseIdleCurrentAccount(session)
        if (!session.inFlight && (session.run.run.status === 'running' || session.run.run.status === 'created')) {
          session.run = this.runs.pause(session.runId)
        }
        const next = nextScheduleStart(schedules, now)
        session.status = 'waiting_window'
        session.nextActionAt = next?.getTime() ?? null
        session.message = next
          ? `Ngoài khung giờ chạy; chờ đến ${next.toLocaleString()}.`
          : 'Ngoài khung giờ chạy.'
        const waitMs = next ? Math.max(250, Math.min(30_000, next.getTime() - now.getTime())) : 30_000
        await this.clock.sleep(waitMs)
        continue
      }

      if (session.activeDateKey !== null && session.activeDateKey !== todayKey) {
        this.rolloverForDay(session, todayKey)
      } else if (session.activeDateKey === null) {
        session.activeDateKey = todayKey
      }

      if (isRunExhausted(session.run)) continue
      if (session.run.run.status !== 'running') session.run = this.runs.resume(session.runId)
      session.status = 'running'
      session.nextActionAt = null
      return true
    }
    return false
  }

  private async waitConfiguredDelay(
    session: RotationSession,
    minSeconds: number,
    maxSeconds: number,
    label: string
  ): Promise<boolean> {
    const expectedRunId = session.runId
    let remainingMs = randomDelaySeconds(minSeconds, maxSeconds, this.clock.random) * 1000
    if (remainingMs <= 0) return true
    session.message = `${label}: ${Math.ceil(remainingMs / 1000)}s.`

    while (remainingMs > 0 && !session.disposed) {
      const runnable = await this.waitUntilRunnable(session)
      if (!runnable || session.runId !== expectedRunId) return false
      const chunk = Math.min(1000, remainingMs)
      session.nextActionAt = this.clock.now().getTime() + remainingMs
      await this.clock.sleep(chunk)
      remainingMs -= chunk
    }
    session.nextActionAt = null
    return !session.disposed && session.runId === expectedRunId
  }
}
