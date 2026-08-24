import { DEFAULT_APP_SETTINGS, type NetworkSettings, type SessionSettings } from '../../shared/appSettings'
import type { PageTabScheduleInput } from '../../shared/pageTabs'
import type { ExecuteSinglePostingJobPayload, ExecuteSinglePostingJobResult } from '../../shared/posting'
import type { RotationPageTabPayload, RotationRuntimeSnapshot, RotationRuntimeStatus } from '../../shared/rotation'
import type { RunDetails, RunSnapshotAccount } from '../../shared/runs'
import { resolveNetworkFailureDecision } from './networkFailurePolicy'
import { isWithinSchedule, nextScheduleStart, randomDelaySeconds } from './rotationSchedule'
import { resolveSessionFailureDecision } from './sessionFailurePolicy'

export interface RotationRunStore {
  getLatestForPageTab(pageTabId: number): RunDetails | null
  createForPageTab(pageTabId: number): RunDetails
  get(runId: number): RunDetails | null
  pause(runId: number): RunDetails
  resume(runId: number): RunDetails
}

export interface RotationPostingExecutor {
  executeSingle(payload: ExecuteSinglePostingJobPayload): Promise<ExecuteSinglePostingJobResult>
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
    if (existing && !['completed', 'error'].includes(existing.status)) {
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
      disposed: false
    }

    this.attachSession(session)
    return snapshotSession(session)
  }

  status(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    if (this.session?.pageTabId === payload.pageTabId) return snapshotSession(this.session)
    const run = this.runs.getLatestForPageTab(payload.pageTabId)
    return {
      pageTabId: payload.pageTabId,
      runId: run?.run.id ?? null,
      status: run?.run.status === 'completed' ? 'completed' : run?.run.status === 'paused' ? 'paused' : 'idle',
      currentAccountId: null,
      currentAccountIndex: null,
      slotsCompletedThisTurn: 0,
      targetSlotsThisTurn: 0,
      cycle: 0,
      nextActionAt: null,
      message: run?.run.status === 'running' ? `Phiên #${run.run.id} đang chạy ngoài bộ điều phối tài khoản.` : null,
      lastResult: null,
      run
    }
  }

  pause(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    const session = this.requireSession(payload.pageTabId)
    if (session.status === 'completed' || session.status === 'error') return snapshotSession(session)
    session.manualPaused = true
    session.status = 'paused'
    session.message = 'Đã tạm dừng thủ công; tác vụ đang chạy (nếu có) sẽ hoàn tất trước khi dừng lượt tiếp theo.'
    session.nextActionAt = null
    if (session.run.run.status === 'running' || session.run.run.status === 'created') {
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
    if (session.status === 'error') throw new Error('Vòng chạy đang lỗi; hãy bắt đầu lại sau khi xử lý nguyên nhân.')

    session.manualPaused = false
    session.message = restoredAfterRestart
      ? 'Đã khôi phục phiên chạy sau khi khởi động lại ứng dụng.'
      : 'Đang tiếp tục vòng chạy tài khoản.'
    const schedules = this.schedulesFor(session)
    if (isWithinSchedule(schedules, this.clock.now())) {
      if (session.run.run.status !== 'running') session.run = this.runs.resume(session.runId)
      session.status = 'running'
      session.nextActionAt = null
    } else {
      if (session.run.run.status === 'running' || session.run.run.status === 'created') {
        session.run = this.runs.pause(session.runId)
      }
      session.status = 'waiting_window'
      session.nextActionAt = nextScheduleStart(schedules, this.clock.now())?.getTime() ?? null
    }

    if (restoredAfterRestart) this.attachSession(session)
    return snapshotSession(session)
  }

  async waitForSettled(): Promise<void> {
    await this.loopPromise
  }

  dispose(): void {
    if (!this.session) return
    this.session.disposed = true
    if (this.session.run.run.status === 'running' || this.session.run.run.status === 'created') {
      try {
        this.session.run = this.runs.pause(this.session.runId)
      } catch {
        // Shutdown should continue even when DB state already changed.
      }
    }
  }

  private attachSession(session: RotationSession): void {
    this.session = session
    this.loopPromise = this.runLoop(session).catch((cause) => {
      if (session.disposed) return
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
    const accounts = sortedEnabledAccounts(session.run)
    let accountIndex = 0
    let unavailableStreak = 0

    while (!session.disposed) {
      const ready = await this.waitUntilRunnable(session)
      if (!ready) return

      const current = this.runs.get(session.runId)
      if (!current) throw new Error(`Không tìm thấy phiên #${session.runId}.`)
      session.run = current
      if (current.run.status === 'completed' || current.metrics.remaining === 0) {
        session.status = 'completed'
        session.message = 'Phiên chạy đã hoàn tất toàn bộ hàng chờ.'
        session.nextActionAt = null
        return
      }

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
      while (session.slotsCompletedThisTurn < targetSlots && !session.disposed) {
        const canPost = await this.waitUntilRunnable(session)
        if (!canPost) return

        const result = await this.posting.executeSingle({ runId: session.runId, accountId: account.accountId })
        session.run = result.run
        session.lastResult = result.result
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
          if (result.result.code === 'no_pending_item' || result.run.run.status === 'completed' || result.run.metrics.remaining === 0) {
            session.status = 'completed'
            session.message = 'Phiên chạy không còn Group chờ xử lý.'
            session.nextActionAt = null
            return
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

        if (result.run.run.status === 'completed' || result.run.metrics.remaining === 0) {
          session.status = 'completed'
          session.message = 'Phiên chạy đã hoàn tất toàn bộ hàng chờ.'
          session.nextActionAt = null
          return
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
          await this.waitConfiguredDelay(
            session,
            current.run.snapshot.rotation.postDelayMinSeconds,
            current.run.snapshot.rotation.postDelayMaxSeconds,
            'Chờ giữa các bài'
          )
        }
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
        if (accounts.length > 1) {
          await this.waitConfiguredDelay(
            session,
            rotation.accountDelayMinSeconds,
            rotation.accountDelayMaxSeconds,
            'Chờ đổi tài khoản'
          )
        } else {
          await this.waitConfiguredDelay(
            session,
            rotation.postDelayMinSeconds,
            rotation.postDelayMaxSeconds,
            'Chờ giữa các bài'
          )
        }
      }
    }
  }

  private async waitUntilRunnable(session: RotationSession): Promise<boolean> {
    while (!session.disposed) {
      if (session.manualPaused) {
        session.status = 'paused'
        session.nextActionAt = null
        if (session.run.run.status === 'running' || session.run.run.status === 'created') {
          session.run = this.runs.pause(session.runId)
        }
        await this.clock.sleep(250)
        continue
      }

      const now = this.clock.now()
      const schedules = this.schedulesFor(session)
      if (!isWithinSchedule(schedules, now)) {
        if (session.run.run.status === 'running' || session.run.run.status === 'created') {
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
  ): Promise<void> {
    let remainingMs = randomDelaySeconds(minSeconds, maxSeconds, this.clock.random) * 1000
    if (remainingMs <= 0) return
    session.message = `${label}: ${Math.ceil(remainingMs / 1000)}s.`

    while (remainingMs > 0 && !session.disposed) {
      const runnable = await this.waitUntilRunnable(session)
      if (!runnable) return
      const chunk = Math.min(1000, remainingMs)
      session.nextActionAt = this.clock.now().getTime() + remainingMs
      await this.clock.sleep(chunk)
      remainingMs -= chunk
    }
    session.nextActionAt = null
  }
}
