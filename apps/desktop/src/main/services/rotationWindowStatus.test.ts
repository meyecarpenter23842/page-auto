import { describe, expect, it } from 'vitest'
import type { PageTabScheduleInput } from '../../shared/pageTabs'
import type { ExecuteSinglePostingJobResult } from '../../shared/posting'
import type { RunDetails, RunItem } from '../../shared/runs'
import { RotationService, type RotationRunStore, type RunStopReason } from './rotationService'

interface StoredWindowState {
  dateKey: string | null
  activeWindowKey: string | null
  closedWindows: Array<{
    key: string
    status: 'closed_account_cycle' | 'closed_time_remaining_accounts'
    closedAt: number
    currentAccountId: number | null
    slotsCompletedThisTurn: number
    targetSlotsThisTurn: number
    groupRemaining: number
  }>
}

const mondayWindows: PageTabScheduleInput[] = [
  { dayOfWeek: 1, startMinute: 420, endMinute: 720, enabled: true, sortOrder: 0 },
  { dayOfWeek: 1, startMinute: 780, endMinute: 1080, enabled: true, sortOrder: 1 }
]

function makeRun(postsPerTurn = 1, groupSourceCount = 5, runId = 1): RunDetails {
  return {
    run: {
      id: runId,
      pageTabId: 10,
      status: 'created',
      tabName: 'Page A',
      pageUid: '90001',
      snapshot: {
        version: 1,
        pageTabId: 10,
        tabName: 'Page A',
        pageUid: '90001',
        rotation: {
          postsPerAccount: postsPerTurn,
          postDelayMinSeconds: 0,
          postDelayMaxSeconds: 0,
          accountDelayMinSeconds: 0,
          accountDelayMaxSeconds: 0,
          accountOrderMode: 'sequential'
        },
        accounts: [{ accountId: 101, enabled: true, sortOrder: 0, postsPerTurn }],
        schedules: mondayWindows.map((schedule) => ({ ...schedule })),
        contentMode: 'sequential',
        contents: ['hello'],
        image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' },
        groupSourceCount
      },
      createdAt: 1,
      startedAt: null,
      pausedAt: null,
      completedAt: null,
      updatedAt: 1
    },
    metrics: {
      total: groupSourceCount,
      pending: groupSourceCount,
      processing: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      remaining: groupSourceCount,
      progressPercent: 0
    }
  }
}

class WindowStore implements RotationRunStore {
  details = makeRun()
  readonly rotationStates = new Map<number, { activeDateKey: string | null; completedWindowKey: string | null }>()
  readonly windowStates = new Map<number, StoredWindowState>()
  onPause: (() => void) | null = null

  getLatestForPageTab(): RunDetails { return this.details }
  createForPageTab(): RunDetails {
    const previous = this.details
    this.details = makeRun(
      previous.run.snapshot.rotation.postsPerAccount,
      previous.run.snapshot.groupSourceCount,
      previous.run.id + 1
    )
    return this.details
  }
  get(runId: number): RunDetails | null {
    return this.details.run.id === runId ? this.details : null
  }
  pause(): RunDetails {
    this.details.run.status = 'paused'
    this.onPause?.()
    return this.details
  }
  resume(): RunDetails {
    this.details.run.status = 'running'
    return this.details
  }
  stop(_runId: number, _reason?: RunStopReason): RunDetails {
    this.details.run.status = 'stopped'
    return this.details
  }
  getRotationState(runId: number) { return this.rotationStates.get(runId) ?? null }
  saveRotationState(runId: number, state: { activeDateKey: string | null; completedWindowKey: string | null }): void {
    this.rotationStates.set(runId, { ...state })
  }
  getRotationWindowState(runId: number): StoredWindowState | null {
    const state = this.windowStates.get(runId)
    return state ? { ...state, closedWindows: state.closedWindows.map((entry) => ({ ...entry })) } : null
  }
  saveRotationWindowState(runId: number, state: StoredWindowState): void {
    this.windowStates.set(runId, { ...state, closedWindows: state.closedWindows.map((entry) => ({ ...entry })) })
  }
  succeedOne(): RunDetails {
    this.details.metrics.pending -= 1
    this.details.metrics.remaining -= 1
    this.details.metrics.success += 1
    this.details.metrics.progressPercent = Math.round((this.details.metrics.success / this.details.metrics.total) * 100)
    if (this.details.metrics.remaining === 0) this.details.run.status = 'completed'
    return this.details
  }
}

function item(runId = 1): RunItem {
  return {
    id: 1,
    runId,
    sourceGroupItemId: 1,
    groupUid: 'group-1',
    sortOrder: 0,
    status: 'success',
    attemptCount: 1,
    lastError: null,
    startedAt: 1,
    finishedAt: 2,
    updatedAt: 2
  }
}

function never(): Promise<never> {
  return new Promise<never>(() => undefined)
}

function posting(store: WindowStore, afterSuccess?: () => void) {
  return {
    executeSingle: async (): Promise<ExecuteSinglePostingJobResult> => {
      const run = store.succeedOne()
      afterSuccess?.()
      return { accountId: 101, item: item(run.run.id), result: { status: 'success', message: 'ok' }, run }
    }
  }
}

describe('RotationService persisted window status', () => {
  it('persists account-cycle closure and restores the reason after restart', async () => {
    const store = new WindowStore()
    const now = new Date(2026, 7, 24, 10, 0)
    const service = new RotationService(store, posting(store), {
      now: () => now,
      random: () => 0,
      sleep: async () => never()
    })

    service.start({ pageTabId: 10 })
    await service.waitForSettled()

    const closed = service.status({ pageTabId: 10 }).windowStates?.[0]
    expect(closed?.status).toBe('closed_account_cycle')
    expect(closed?.groupRemaining).toBe(4)
    service.dispose()

    const restarted = new RotationService(store, posting(store), {
      now: () => now,
      random: () => 0,
      sleep: async () => never()
    })
    expect(restarted.status({ pageTabId: 10 }).windowStates?.[0]?.status).toBe('closed_account_cycle')
    restarted.dispose()
  })

  it('persists time closure with remaining account work and restores it after restart', async () => {
    const store = new WindowStore()
    store.details = makeRun(2)
    let now = new Date(2026, 7, 24, 11, 59, 59)
    let resolvePaused!: () => void
    const paused = new Promise<void>((resolve) => { resolvePaused = resolve })
    store.onPause = resolvePaused

    const service = new RotationService(store, posting(store, () => {
      now = new Date(2026, 7, 24, 12, 0, 1)
    }), {
      now: () => now,
      random: () => 0,
      sleep: async () => never()
    })

    service.start({ pageTabId: 10 })
    await paused

    const closed = service.status({ pageTabId: 10 }).windowStates?.[0]
    expect(closed?.status).toBe('closed_time_remaining_accounts')
    expect(closed?.groupRemaining).toBe(4)
    service.dispose()

    const restarted = new RotationService(store, posting(store), {
      now: () => now,
      random: () => 0,
      sleep: async () => never()
    })
    expect(restarted.status({ pageTabId: 10 }).windowStates?.[0]?.status).toBe('closed_time_remaining_accounts')
    restarted.dispose()
  })

  it('keeps earlier same-day window closures when a later window refills the Group run after restart', async () => {
    const store = new WindowStore()
    store.details = makeRun(1, 1)
    let now = new Date(2026, 7, 24, 10, 0)
    const service = new RotationService(store, posting(store), {
      now: () => now,
      random: () => 0,
      sleep: async () => never()
    })

    service.start({ pageTabId: 10 })
    await service.waitForSettled()
    expect(service.status({ pageTabId: 10 }).windowStates?.[0]?.status).toBe('closed_account_cycle')
    expect(store.details.run.status).toBe('completed')
    service.dispose()

    now = new Date(2026, 7, 24, 13, 0)
    const restarted = new RotationService(store, { executeSingle: async () => never() }, {
      now: () => now,
      random: () => 0,
      sleep: async () => never()
    })
    const resumed = restarted.resume({ pageTabId: 10 })

    expect(store.details.run.id).toBe(2)
    expect(resumed.windowStates?.[0]?.status).toBe('closed_account_cycle')
    expect(resumed.windowStates?.[1]?.status).toBe('running')
    expect(store.windowStates.get(2)?.closedWindows[0]?.status).toBe('closed_account_cycle')
    restarted.dispose()
  })

  it('uses newer executor progress instead of a stale UI snapshot when closing a window', async () => {
    const store = new WindowStore()
    store.details = makeRun(2)
    const now = new Date(2026, 7, 24, 10, 0)
    let calls = 0
    let resolveSecondStarted!: () => void
    const secondStarted = new Promise<void>((resolve) => { resolveSecondStarted = resolve })
    let resolveSecond!: () => void
    const secondGate = new Promise<void>((resolve) => { resolveSecond = resolve })

    const service = new RotationService(store, {
      executeSingle: async (): Promise<ExecuteSinglePostingJobResult> => {
        calls += 1
        if (calls === 2) {
          resolveSecondStarted()
          await secondGate
        }
        const run = store.succeedOne()
        return { accountId: 101, item: item(run.run.id), result: { status: 'success', message: 'ok' }, run }
      }
    }, {
      now: () => now,
      random: () => 0,
      sleep: async () => never()
    })

    service.start({ pageTabId: 10 })
    await secondStarted

    const stale = service.status({ pageTabId: 10 })
    expect(stale.currentAccountId).toBe(101)
    expect(stale.slotsCompletedThisTurn).toBe(1)
    expect(stale.targetSlotsThisTurn).toBe(2)

    resolveSecond()
    await service.waitForSettled()

    const closed = service.status({ pageTabId: 10 }).windowStates?.[0]
    expect(closed?.status).toBe('closed_account_cycle')
    expect(closed?.currentAccountId).toBe(101)
    expect(closed?.slotsCompletedThisTurn).toBe(2)
    expect(closed?.targetSlotsThisTurn).toBe(2)
    expect(closed?.groupRemaining).toBe(3)
    service.dispose()
  })
})
