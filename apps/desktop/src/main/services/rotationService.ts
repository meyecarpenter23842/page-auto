import type { NetworkSettings, SessionSettings } from '../../shared/appSettings'
import type { PageTabScheduleInput } from '../../shared/pageTabs'
import type {
  RotationPageTabPayload,
  RotationRuntimeSnapshot,
  RotationWindowRuntimeState
} from '../../shared/rotation'
import type { RunDetails } from '../../shared/runs'
import type { AccountExecutionCoordinator } from './accountExecutionCoordinator'
import { ParallelRotationService } from './parallelRotationService'
import { scheduleWindowKey } from './rotationSchedule'
import { RotationService as CoreRotationService } from './rotationServiceCore'
import type { RotationPostingExecutor, RotationRunStore } from './rotationServiceCore'

export type { RotationPostingExecutor, RotationRunStore, RunStopReason } from './rotationServiceCore'

interface RotationClockLike {
  now: () => Date
  random: () => number
  sleep: (milliseconds: number) => Promise<void>
}

interface PersistedClosedWindow {
  key: string
  status: 'closed_account_cycle' | 'closed_time_remaining_accounts'
  closedAt: number
  currentAccountId: number | null
  slotsCompletedThisTurn: number
  targetSlotsThisTurn: number
  groupRemaining: number
}

interface PersistedWindowState {
  dateKey: string | null
  activeWindowKey: string | null
  closedWindows: PersistedClosedWindow[]
}

interface WindowStateRunStoreExtension {
  getRotationWindowState?: (runId: number) => PersistedWindowState | null
  saveRotationWindowState?: (runId: number, state: PersistedWindowState) => void
}

interface ObservedAccountTurn {
  accountId: number
  slotsCompleted: number
  targetSlots: number
}

type RotationCommand = 'start' | 'resume'
type RotationMode = 'serial' | 'parallel'

function localDateKey(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

function windowKey(dateKey: string, schedule: PageTabScheduleInput): string {
  return `${dateKey}:${schedule.sortOrder}:${schedule.startMinute}-${schedule.endMinute}`
}

function cloneWindowState(state: PersistedWindowState): PersistedWindowState {
  return {
    dateKey: state.dateKey,
    activeWindowKey: state.activeWindowKey,
    closedWindows: state.closedWindows.map((entry) => ({ ...entry }))
  }
}

class RotationWindowTracker {
  private state: (PersistedWindowState & { runId: number }) | null = null
  private lastSnapshot: RotationRuntimeSnapshot | null = null
  private lastSnapshotSequence = 0
  private lastCycle = 0
  private observedTurn: ObservedAccountTurn | null = null
  private observedTurnSequence = 0
  private observedGroupRemaining: number | null = null
  private observationSequence = 0
  private command: RotationCommand | null = null
  private resetHistoryOnNextRunCreate = false

  constructor(
    private readonly runs: RotationRunStore,
    private readonly getLiveSchedules: (pageTabId: number) => PageTabScheduleInput[] | null,
    private readonly now: () => Date
  ) {}

  runCommand<T>(command: RotationCommand, action: () => T): T {
    const previous = this.command
    this.command = command
    try { return action() } finally { this.command = previous }
  }

  discardInvalidCreatedRun(pageTabId: number): void {
    const run = this.runs.getLatestForPageTab(pageTabId)
    if (!run || run.run.status !== 'created') return
    if (run.run.snapshot.accounts.some((account) => account.enabled)) return
    this.runs.stop(run.run.id, 'manual')
    this.resetHistoryOnNextRunCreate = true
  }

  trackedRunStore(): RotationRunStore {
    return {
      getLatestForPageTab: (pageTabId) => this.runs.getLatestForPageTab(pageTabId),
      createForPageTab: (pageTabId) => {
        const previous = this.runs.getLatestForPageTab(pageTabId)
        if (this.command !== 'start' && previous && this.state?.runId !== previous.run.id) this.ensureState(previous)
        const fresh = this.runs.createForPageTab(pageTabId)
        this.noteRunCreated(fresh, this.command === 'start')
        return fresh
      },
      get: (runId) => this.runs.get(runId),
      pause: (runId) => {
        const paused = this.runs.pause(runId)
        this.notePause(paused)
        return paused
      },
      resume: (runId) => {
        const resumed = this.runs.resume(runId)
        this.noteResume(resumed)
        return resumed
      },
      stop: (runId, reason) => {
        const stopped = this.runs.stop(runId, reason)
        if (reason === 'manual' || reason === 'daily_rollover') this.resetHistoryOnNextRunCreate = true
        return stopped
      },
      getRotationState: (runId) => this.runs.getRotationState?.(runId) ?? null,
      saveRotationState: (runId, state) => {
        this.runs.saveRotationState?.(runId, state)
        this.noteCoreRotationState(runId, state)
      }
    }
  }

  trackedPostingExecutor(posting: RotationPostingExecutor): RotationPostingExecutor {
    return {
      executeSingle: async (payload) => {
        const result = await posting.executeSingle(payload)
        const accountId = payload.accountId ?? result.accountId
        if (accountId !== null && accountId !== undefined) this.notePostingResult(accountId, result.run, result.result.status)
        return result
      },
      ...(posting.releaseAccount ? { releaseAccount: (accountId: number) => posting.releaseAccount!(accountId) } : {})
    }
  }

  decorate(snapshot: RotationRuntimeSnapshot): RotationRuntimeSnapshot {
    this.lastSnapshot = snapshot
    this.lastSnapshotSequence = ++this.observationSequence
    this.reconcile(snapshot)
    const windowStates = this.buildWindowStates(snapshot)
    this.lastCycle = snapshot.cycle
    return { ...snapshot, windowStates }
  }

  private extension(): WindowStateRunStoreExtension {
    return this.runs as RotationRunStore & WindowStateRunStoreExtension
  }

  private schedulesFor(pageTabId: number, run: RunDetails | null): PageTabScheduleInput[] {
    return this.getLiveSchedules(pageTabId) ?? run?.run.snapshot.schedules ?? []
  }

  private ensureState(run: RunDetails): PersistedWindowState & { runId: number } {
    const dateKey = localDateKey(this.now())
    if (this.state?.runId === run.run.id) {
      if (this.state.dateKey !== dateKey) this.resetForDate(run.run.id, dateKey)
      return this.state
    }
    const persisted = this.extension().getRotationWindowState?.(run.run.id) ?? null
    this.state = {
      runId: run.run.id,
      dateKey: persisted?.dateKey === dateKey ? persisted.dateKey : dateKey,
      activeWindowKey: persisted?.dateKey === dateKey ? persisted.activeWindowKey : null,
      closedWindows: persisted?.dateKey === dateKey ? persisted.closedWindows.map((entry) => ({ ...entry })) : []
    }
    this.observedGroupRemaining = run.metrics.remaining
    return this.state
  }

  private resetForDate(runId: number, dateKey: string): void {
    this.state = { runId, dateKey, activeWindowKey: null, closedWindows: [] }
    this.observedTurn = null
    this.observedTurnSequence = 0
    this.observedGroupRemaining = null
    this.persist()
  }

  private persist(): void {
    if (!this.state) return
    this.extension().saveRotationWindowState?.(this.state.runId, cloneWindowState(this.state))
  }

  private currentWindowKey(pageTabId: number, run: RunDetails | null): string | null {
    return scheduleWindowKey(this.schedulesFor(pageTabId, run), this.now())
  }

  private noteRunCreated(run: RunDetails, forceReset: boolean): void {
    const dateKey = localDateKey(this.now())
    const preserve = !forceReset && !this.resetHistoryOnNextRunCreate && this.state?.dateKey === dateKey
    this.resetHistoryOnNextRunCreate = false
    this.state = preserve && this.state
      ? { ...this.state, runId: run.run.id, closedWindows: this.state.closedWindows.map((entry) => ({ ...entry })) }
      : { runId: run.run.id, dateKey, activeWindowKey: null, closedWindows: [] }
    if (!preserve) { this.observedTurn = null; this.observedTurnSequence = 0 }
    this.observedGroupRemaining = run.metrics.remaining
    this.persist()
  }

  private noteResume(run: RunDetails): void {
    const state = this.ensureState(run)
    const currentKey = this.currentWindowKey(run.run.pageTabId ?? run.run.snapshot.pageTabId, run)
    if (!currentKey || state.closedWindows.some((entry) => entry.key === currentKey)) return
    if (state.activeWindowKey === currentKey) return
    state.activeWindowKey = currentKey
    this.observedGroupRemaining = run.metrics.remaining
    this.persist()
  }

  private notePause(run: RunDetails): void {
    const state = this.ensureState(run)
    if (!state.activeWindowKey) return
    const pageTabId = run.run.pageTabId ?? run.run.snapshot.pageTabId
    const currentKey = this.currentWindowKey(pageTabId, run)
    if (currentKey === state.activeWindowKey) return
    this.closeWindow(state.activeWindowKey, 'closed_time_remaining_accounts', this.lastSnapshot)
  }

  private notePostingResult(accountId: number, run: RunDetails, resultStatus: string): void {
    const target = run.run.snapshot.accounts.find((account) => account.accountId === accountId)?.postsPerTurn ?? run.run.snapshot.rotation.postsPerAccount
    if (this.observedTurn?.accountId !== accountId) this.observedTurn = { accountId, slotsCompleted: 0, targetSlots: target }
    else this.observedTurn.targetSlots = target
    if (resultStatus === 'success') this.observedTurn.slotsCompleted += 1
    this.observedGroupRemaining = run.metrics.remaining
    this.observedTurnSequence = ++this.observationSequence
  }

  private noteCoreRotationState(runId: number, state: { activeDateKey: string | null; completedWindowKey: string | null }): void {
    if (!state.completedWindowKey) return
    const run = this.runs.get(runId)
    if (!run) return
    this.ensureState(run)
    this.closeWindow(state.completedWindowKey, 'closed_account_cycle', this.lastSnapshot)
  }

  private reconcile(snapshot: RotationRuntimeSnapshot): void {
    const run = snapshot.run
    if (!run || snapshot.runId === null) return
    const state = this.ensureState(run)
    const currentKey = this.currentWindowKey(snapshot.pageTabId, run)
    const coreState = this.runs.getRotationState?.(snapshot.runId) ?? null
    if (coreState?.completedWindowKey) this.closeWindow(coreState.completedWindowKey, 'closed_account_cycle', snapshot)
    if (state.activeWindowKey && state.activeWindowKey !== currentKey) this.closeWindow(state.activeWindowKey, 'closed_time_remaining_accounts', snapshot)
    const cycleAdvanced = snapshot.cycle > this.lastCycle
    if (cycleAdvanced && currentKey && state.activeWindowKey === currentKey) this.closeWindow(currentKey, 'closed_account_cycle', snapshot)
    const canMarkActive = snapshot.status === 'starting' || snapshot.status === 'running' || snapshot.status === 'paused'
    if (currentKey && canMarkActive && !state.closedWindows.some((entry) => entry.key === currentKey) && state.activeWindowKey !== currentKey) {
      state.activeWindowKey = currentKey
      this.persist()
    }
  }

  private closeWindow(key: string, status: PersistedClosedWindow['status'], source: RotationRuntimeSnapshot | null): void {
    if (!this.state) return
    const existingIndex = this.state.closedWindows.findIndex((entry) => entry.key === key)
    if (existingIndex >= 0) {
      const existing = this.state.closedWindows[existingIndex]
      if (existing?.status === 'closed_account_cycle' || existing?.status === status) {
        if (this.state.activeWindowKey === key) { this.state.activeWindowKey = null; this.persist() }
        if (status === 'closed_account_cycle') { this.observedTurn = null; this.observedTurnSequence = 0 }
        return
      }
    }
    const sourceHasAccount = source?.currentAccountId !== null && source?.currentAccountId !== undefined
    const observedIsFresher = this.observedTurn !== null && (!sourceHasAccount || this.observedTurnSequence > this.lastSnapshotSequence)
    const closed: PersistedClosedWindow = {
      key,
      status,
      closedAt: this.now().getTime(),
      currentAccountId: observedIsFresher ? this.observedTurn!.accountId : sourceHasAccount ? source.currentAccountId : null,
      slotsCompletedThisTurn: observedIsFresher ? this.observedTurn!.slotsCompleted : sourceHasAccount ? source.slotsCompletedThisTurn : 0,
      targetSlotsThisTurn: observedIsFresher ? this.observedTurn!.targetSlots : sourceHasAccount ? source.targetSlotsThisTurn : 0,
      groupRemaining: this.observedGroupRemaining ?? source?.run?.metrics.remaining ?? 0
    }
    if (existingIndex >= 0) this.state.closedWindows[existingIndex] = closed
    else this.state.closedWindows.push(closed)
    if (this.state.activeWindowKey === key) this.state.activeWindowKey = null
    this.persist()
    if (status === 'closed_account_cycle') { this.observedTurn = null; this.observedTurnSequence = 0 }
  }

  private buildWindowStates(snapshot: RotationRuntimeSnapshot): RotationWindowRuntimeState[] {
    const now = this.now()
    const dateKey = localDateKey(now)
    const run = snapshot.run
    const schedules = this.schedulesFor(snapshot.pageTabId, run)
    const enabled = schedules.filter((schedule) => schedule.enabled)
    const currentKey = scheduleWindowKey(schedules, now)
    const state = run ? this.ensureState(run) : null
    const rows: Array<{ key: string; dayOfWeek: number; startMinute: number; endMinute: number; sortOrder: number }> = enabled.length === 0
      ? [{ key: `${dateKey}:all-day`, dayOfWeek: now.getDay(), startMinute: 0, endMinute: 1440, sortOrder: 0 }]
      : enabled.filter((schedule) => schedule.dayOfWeek === now.getDay())
          .sort((a, b) => a.sortOrder - b.sortOrder || a.startMinute - b.startMinute || a.endMinute - b.endMinute)
          .map((schedule) => ({ key: windowKey(dateKey, schedule), dayOfWeek: schedule.dayOfWeek, startMinute: schedule.startMinute, endMinute: schedule.endMinute, sortOrder: schedule.sortOrder }))
    return rows.map((row) => {
      const closed = state?.closedWindows.find((entry) => entry.key === row.key) ?? null
      const running = !closed && state?.activeWindowKey === row.key && currentKey === row.key
      return {
        key: row.key,
        dateKey,
        dayOfWeek: row.dayOfWeek,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
        sortOrder: row.sortOrder,
        status: closed?.status ?? (running ? 'running' : 'upcoming'),
        currentAccountId: closed?.currentAccountId ?? (running ? snapshot.currentAccountId : null),
        slotsCompletedThisTurn: closed?.slotsCompletedThisTurn ?? (running ? snapshot.slotsCompletedThisTurn : 0),
        targetSlotsThisTurn: closed?.targetSlotsThisTurn ?? (running ? snapshot.targetSlotsThisTurn : 0),
        groupRemaining: closed?.groupRemaining ?? snapshot.run?.metrics.remaining ?? 0,
        closedAt: closed?.closedAt ?? null
      }
    })
  }
}

export class RotationService {
  private readonly core: CoreRotationService
  private readonly parallel: ParallelRotationService
  private readonly tracker: RotationWindowTracker
  private activeMode: RotationMode | null = null

  constructor(
    private readonly runs: RotationRunStore,
    posting: RotationPostingExecutor,
    clock?: RotationClockLike,
    getSessionSettings?: () => SessionSettings,
    getNetworkSettings?: () => NetworkSettings,
    getLiveSchedules: (pageTabId: number) => PageTabScheduleInput[] | null = () => null,
    private readonly getLiveAccountConcurrency: (pageTabId: number) => number = () => 1,
    accountExecution?: AccountExecutionCoordinator
  ) {
    this.tracker = new RotationWindowTracker(runs, getLiveSchedules, clock?.now ?? (() => new Date()))
    const trackedRuns = this.tracker.trackedRunStore()
    const trackedPosting = this.tracker.trackedPostingExecutor(posting)
    this.core = new CoreRotationService(trackedRuns, trackedPosting, clock, getSessionSettings, getNetworkSettings, getLiveSchedules)
    this.parallel = new ParallelRotationService(trackedRuns, trackedPosting, accountExecution, clock, getSessionSettings, getNetworkSettings, getLiveSchedules)
  }

  start(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    return this.tracker.runCommand('start', () => {
      this.tracker.discardInvalidCreatedRun(payload.pageTabId)
      this.activeMode = this.resolveMode(payload.pageTabId)
      return this.tracker.decorate(this.delegate().start(payload))
    })
  }

  status(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    if (!this.activeMode) this.activeMode = this.resolveMode(payload.pageTabId)
    return this.tracker.decorate(this.delegate().status(payload))
  }

  pause(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    return this.tracker.decorate(this.delegate().pause(payload))
  }

  resume(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    return this.tracker.runCommand('resume', () => {
      if (!this.activeMode) this.activeMode = this.resolveMode(payload.pageTabId)
      return this.tracker.decorate(this.delegate().resume(payload))
    })
  }

  stop(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    return this.tracker.decorate(this.delegate().stop(payload))
  }

  waitForSettled(): Promise<void> {
    return this.delegate().waitForSettled()
  }

  dispose(): void {
    this.delegate().dispose()
  }

  private resolveMode(pageTabId: number): RotationMode {
    const latest = this.runs.getLatestForPageTab(pageTabId)
    const activeSnapshot = latest && ['created', 'running', 'paused'].includes(latest.run.status)
      ? latest.run.snapshot.rotation.accountConcurrency ?? 1
      : this.getLiveAccountConcurrency(pageTabId)
    return Number.isFinite(activeSnapshot) && activeSnapshot > 1 ? 'parallel' : 'serial'
  }

  private delegate(): CoreRotationService | ParallelRotationService {
    return this.activeMode === 'parallel' ? this.parallel : this.core
  }
}
