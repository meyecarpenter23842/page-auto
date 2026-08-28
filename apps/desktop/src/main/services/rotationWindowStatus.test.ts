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

function makeRun(postsPerTurn = 1): RunDetails {
  return {
    run: {
      id: 1,
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
        groupSourceCount: 5
      },
      createdAt: 1,
      startedAt: null,
      pausedAt: null,
      completedAt: null,
      updatedAt: 1
    },
    metrics: {
      total: 5,
      pending: 5,
      processing: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      remaining: 5,
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
  createForPageTab(): RunDetails { return this.details }
  get(): RunDetails { return this.details }
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
    return this.details
  }
}

function item(): RunItem {
  return {
    id: 1,
    runId: 1,
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
      return { accountId: 101, item: item(), result: { status: 'success', message: 'ok' }, run }
    }
  }
}

describe('RotationService persisted window status', () => {
  it('persists account-cycle closure and restores the reason after restart', async () => {
    const store = new WindowStore()
    let now = new Date(2026, 7, 24, 10, 0)
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
})
