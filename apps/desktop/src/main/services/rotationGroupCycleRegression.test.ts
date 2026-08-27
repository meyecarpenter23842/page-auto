import { describe, expect, it } from 'vitest'
import type { PageTabScheduleInput } from '../../shared/pageTabs'
import type { ExecuteSinglePostingJobResult } from '../../shared/posting'
import type { RunDetails, RunItem } from '../../shared/runs'
import { RotationService, type RotationRunStore, type RunStopReason } from './rotationService'

const mondayTwoWindows: PageTabScheduleInput[] = [
  { dayOfWeek: 1, startMinute: 420, endMinute: 720, enabled: true, sortOrder: 0 },
  { dayOfWeek: 1, startMinute: 780, endMinute: 1080, enabled: true, sortOrder: 1 }
]

function makeRun(id: number, total: number, schedules: PageTabScheduleInput[], postsPerTurn = 1): RunDetails {
  return {
    run: {
      id,
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
        accounts: [
          { accountId: 101, enabled: true, sortOrder: 0, postsPerTurn },
          { accountId: 202, enabled: true, sortOrder: 1, postsPerTurn }
        ],
        schedules: schedules.map((schedule) => ({ ...schedule })),
        contentMode: 'sequential',
        contents: ['hello'],
        image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' },
        groupSourceCount: total
      },
      createdAt: id,
      startedAt: null,
      pausedAt: null,
      completedAt: null,
      updatedAt: id
    },
    metrics: {
      total,
      pending: total,
      processing: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      remaining: total,
      progressPercent: 0
    }
  }
}

class Store implements RotationRunStore {
  readonly runs = new Map<number, RunDetails>()
  readonly rotationStates = new Map<number, { activeDateKey: string | null; completedWindowKey: string | null }>()
  createCalls = 0
  latestRunId = 1

  constructor(total: number, schedules: PageTabScheduleInput[], postsPerTurn = 1) {
    this.runs.set(1, makeRun(1, total, schedules, postsPerTurn))
  }

  getLatestForPageTab(): RunDetails | null {
    return this.runs.get(this.latestRunId) ?? null
  }

  createForPageTab(): RunDetails {
    const previous = this.getLatestForPageTab()
    if (!previous) throw new Error('missing previous run')
    const id = this.latestRunId + 1
    const next = makeRun(id, previous.run.snapshot.groupSourceCount, previous.run.snapshot.schedules)
    next.run.snapshot.rotation = { ...previous.run.snapshot.rotation }
    next.run.snapshot.accounts = previous.run.snapshot.accounts.map((account) => ({ ...account }))
    next.run.snapshot.schedules = previous.run.snapshot.schedules.map((schedule) => ({ ...schedule }))
    next.run.snapshot.contentMode = previous.run.snapshot.contentMode
    next.run.snapshot.contents = [...previous.run.snapshot.contents]
    next.run.snapshot.image = { ...previous.run.snapshot.image }
    this.latestRunId = id
    this.runs.set(id, next)
    this.createCalls += 1
    return next
  }

  get(runId: number): RunDetails | null {
    return this.runs.get(runId) ?? null
  }

  pause(runId: number): RunDetails {
    const run = this.require(runId)
    if (run.run.status !== 'completed') run.run.status = 'paused'
    return run
  }

  resume(runId: number): RunDetails {
    const run = this.require(runId)
    if (run.run.status === 'completed') throw new Error('cannot resume completed run')
    run.run.status = 'running'
    return run
  }

  stop(runId: number, _reason?: RunStopReason): RunDetails {
    const run = this.require(runId)
    run.run.status = 'stopped'
    return run
  }

  getRotationState(runId: number) {
    return this.rotationStates.get(runId) ?? null
  }

  saveRotationState(runId: number, state: { activeDateKey: string | null; completedWindowKey: string | null }): void {
    this.rotationStates.set(runId, { ...state })
  }

  finishOne(runId: number, status: 'success' | 'failed' | 'skipped' = 'success'): RunDetails {
    const run = this.require(runId)
    run.metrics.pending -= 1
    run.metrics.remaining -= 1
    run.metrics[status] += 1
    const finished = run.metrics.success + run.metrics.failed + run.metrics.skipped
    run.metrics.progressPercent = Math.round((finished / run.metrics.total) * 100)
    if (run.metrics.remaining === 0) run.run.status = 'completed'
    return run
  }

  private require(runId: number): RunDetails {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`missing run ${runId}`)
    return run
  }
}

function item(id: number, runId: number, status: 'success' | 'failed' | 'skipped' = 'success'): RunItem {
  return {
    id,
    runId,
    sourceGroupItemId: id,
    groupUid: `group-${id}`,
    sortOrder: id,
    status,
    attemptCount: 1,
    lastError: status === 'failed' ? 'failed' : null,
    startedAt: 1,
    finishedAt: 2,
    updatedAt: 2
  }
}

function never(): Promise<never> {
  return new Promise<never>(() => undefined)
}

describe('RotationService window/group cycle regressions', () => {
  it('runs at most one full account cycle in a schedule window even when more Groups remain', async () => {
    const store = new Store(10, mondayTwoWindows, 2)
    const calls: Array<{ runId: number; accountId: number }> = []
    let itemId = 1
    const service = new RotationService(store, {
      executeSingle: async (payload): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        calls.push({ runId: payload.runId, accountId })
        const run = store.finishOne(payload.runId)
        return {
          accountId,
          item: item(itemId++, payload.runId),
          result: { status: 'success', message: 'ok' },
          run
        }
      }
    }, {
      now: () => new Date(2026, 7, 24, 10, 0),
      random: () => 0,
      sleep: async () => never()
    })

    service.start({ pageTabId: 10 })
    await service.waitForSettled()

    expect(calls).toEqual([
      { runId: 1, accountId: 101 },
      { runId: 1, accountId: 101 },
      { runId: 1, accountId: 202 },
      { runId: 1, accountId: 202 }
    ])
    expect(store.get(1)?.metrics.remaining).toBe(6)
    expect(store.createCalls).toBe(0)
    expect(service.status({ pageTabId: 10 }).status).toBe('waiting_window')
    service.dispose()
  })

  it('continues remaining Groups in the next window without cloning a fresh Group run early', async () => {
    const store = new Store(5, mondayTwoWindows, 1)
    let now = new Date(2026, 7, 24, 10, 0)
    const firstCalls: Array<{ runId: number; accountId: number }> = []
    let itemId = 1
    const first = new RotationService(store, {
      executeSingle: async (payload): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        firstCalls.push({ runId: payload.runId, accountId })
        const run = store.finishOne(payload.runId)
        return { accountId, item: item(itemId++, payload.runId), result: { status: 'success', message: 'ok' }, run }
      }
    }, {
      now: () => now,
      random: () => 0,
      sleep: async () => never()
    })

    first.start({ pageTabId: 10 })
    await first.waitForSettled()
    expect(firstCalls).toEqual([
      { runId: 1, accountId: 101 },
      { runId: 1, accountId: 202 }
    ])
    expect(store.get(1)?.metrics.remaining).toBe(3)
    expect(store.createCalls).toBe(0)
    first.dispose()

    now = new Date(2026, 7, 24, 14, 0)
    const secondCalls: Array<{ runId: number; accountId: number }> = []
    const second = new RotationService(store, {
      executeSingle: async (payload): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        secondCalls.push({ runId: payload.runId, accountId })
        const run = store.finishOne(payload.runId)
        return { accountId, item: item(itemId++, payload.runId), result: { status: 'success', message: 'ok' }, run }
      }
    }, {
      now: () => now,
      random: () => 0,
      sleep: async () => never()
    })

    const resumed = second.resume({ pageTabId: 10 })
    expect(resumed.status).toBe('running')
    await second.waitForSettled()

    expect(secondCalls).toEqual([
      { runId: 1, accountId: 101 },
      { runId: 1, accountId: 202 }
    ])
    expect(store.get(1)?.metrics.remaining).toBe(1)
    expect(store.createCalls).toBe(0)
    second.dispose()
  })

  it('clones a fresh Group run only after the current Group run is exhausted, without starting a second account cycle', async () => {
    const store = new Store(1, mondayTwoWindows, 1)
    const calls: Array<{ runId: number; accountId: number }> = []
    let itemId = 1
    const service = new RotationService(store, {
      executeSingle: async (payload): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        calls.push({ runId: payload.runId, accountId })
        const run = store.finishOne(payload.runId)
        return { accountId, item: item(itemId++, payload.runId), result: { status: 'success', message: 'ok' }, run }
      }
    }, {
      now: () => new Date(2026, 7, 24, 10, 0),
      random: () => 0,
      sleep: async () => never()
    })

    service.start({ pageTabId: 10 })
    await service.waitForSettled()

    expect(calls).toEqual([
      { runId: 1, accountId: 101 },
      { runId: 2, accountId: 202 }
    ])
    expect(store.get(1)?.run.status).toBe('completed')
    expect(store.get(2)?.run.status).toBe('completed')
    expect(store.createCalls).toBe(1)
    expect(service.status({ pageTabId: 10 }).status).toBe('waiting_window')
    service.dispose()
  })
})
