import { describe, expect, it } from 'vitest'
import type { PageTabScheduleInput } from '../../shared/pageTabs'
import type { ExecuteSinglePostingJobResult } from '../../shared/posting'
import type { RunDetails, RunItem } from '../../shared/runs'
import { RotationService, type RotationRunStore, type RunStopReason } from './rotationService'

function makeRun(total = 7): RunDetails {
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
          postsPerAccount: 1,
          postDelayMinSeconds: 1,
          postDelayMaxSeconds: 1,
          accountDelayMinSeconds: 1,
          accountDelayMaxSeconds: 1,
          accountOrderMode: 'sequential'
        },
        accounts: [
          { accountId: 101, enabled: true, sortOrder: 0, postsPerTurn: 2 },
          { accountId: 202, enabled: true, sortOrder: 1, postsPerTurn: null }
        ],
        schedules: [],
        contentMode: 'sequential',
        contents: ['hello'],
        image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' },
        groupSourceCount: total
      },
      createdAt: 1,
      startedAt: null,
      pausedAt: null,
      completedAt: null,
      updatedAt: 1
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

class FakeRunStore implements RotationRunStore {
  details: RunDetails | null = null
  pauseCalls = 0
  resumeCalls = 0
  stopCalls = 0
  createCalls = 0

  getLatestForPageTab(): RunDetails | null {
    return this.details
  }

  createForPageTab(): RunDetails {
    const previous = this.details
    const next = makeRun(previous?.metrics.total ?? 7)
    next.run.id = (previous?.run.id ?? 0) + 1
    if (previous) {
      next.run.snapshot = {
        ...previous.run.snapshot,
        rotation: { ...previous.run.snapshot.rotation },
        accounts: previous.run.snapshot.accounts.map((account) => ({ ...account })),
        schedules: previous.run.snapshot.schedules.map((schedule) => ({ ...schedule })),
        contents: [...previous.run.snapshot.contents],
        image: { ...previous.run.snapshot.image }
      }
    }
    this.details = next
    this.createCalls += 1
    return next
  }

  get(): RunDetails | null {
    return this.details
  }

  pause(): RunDetails {
    if (!this.details) throw new Error('missing run')
    this.pauseCalls += 1
    this.details.run.status = 'paused'
    return this.details
  }

  resume(): RunDetails {
    if (!this.details) throw new Error('missing run')
    this.resumeCalls += 1
    this.details.run.status = 'running'
    return this.details
  }

  stop(_runId: number, _reason?: RunStopReason): RunDetails {
    if (!this.details) throw new Error('missing run')
    this.stopCalls += 1
    this.details.run.status = 'stopped'
    return this.details
  }

  finishOne(status: 'success' | 'failed' | 'skipped' = 'success'): RunDetails {
    if (!this.details) throw new Error('missing run')
    this.details.metrics.pending -= 1
    this.details.metrics.remaining -= 1
    this.details.metrics[status] += 1
    const finished = this.details.metrics.success + this.details.metrics.failed + this.details.metrics.skipped
    this.details.metrics.progressPercent = Math.round((finished / this.details.metrics.total) * 100)
    if (this.details.metrics.remaining === 0) this.details.run.status = 'completed'
    return this.details
  }
}

function item(id: number, runId: number, status: 'success' | 'failed' | 'skipped' = 'success'): RunItem {
  return {
    id,
    runId,
    sourceGroupItemId: null,
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

const mondayTwoWindows: PageTabScheduleInput[] = [
  { dayOfWeek: 1, startMinute: 420, endMinute: 720, enabled: true, sortOrder: 0 },
  { dayOfWeek: 1, startMinute: 780, endMinute: 1080, enabled: true, sortOrder: 1 }
]

describe('RotationService', () => {
  it('runs exactly one account cycle per window and honors per-account quota before fallback quota', async () => {
    const store = new FakeRunStore()
    const accountCalls: number[] = []
    let nextItemId = 1
    const posting = {
      executeSingle: async (payload: { runId: number; accountId?: number }): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        accountCalls.push(accountId)
        const run = store.finishOne()
        return {
          accountId,
          item: item(nextItemId++, payload.runId),
          result: { status: 'success', message: 'ok' },
          run
        }
      }
    }
    const sleeps: number[] = []
    const service = new RotationService(store, posting, {
      now: () => new Date(2026, 7, 24, 10, 30),
      random: () => 0,
      sleep: async (milliseconds) => {
        if (service.status({ pageTabId: 10 }).status === 'waiting_window') return never()
        sleeps.push(milliseconds)
      }
    })

    service.start({ pageTabId: 10 })
    await service.waitForSettled()

    expect(accountCalls).toEqual([101, 101, 202])
    expect(sleeps).toEqual([1000, 1000])
    expect(service.status({ pageTabId: 10 }).status).toBe('waiting_window')
    expect(store.resumeCalls).toBe(1)
    service.dispose()
  })

  it('continues the same account quota in the next window when the first window closes mid-turn', async () => {
    const store = new FakeRunStore()
    store.details = makeRun(6)
    store.details.run.snapshot.schedules = mondayTwoWindows
    store.details.run.snapshot.rotation.postDelayMinSeconds = 0
    store.details.run.snapshot.rotation.postDelayMaxSeconds = 0
    store.details.run.snapshot.rotation.accountDelayMinSeconds = 0
    store.details.run.snapshot.rotation.accountDelayMaxSeconds = 0
    store.details.run.snapshot.accounts = [
      { accountId: 101, enabled: true, sortOrder: 0, postsPerTurn: 2 },
      { accountId: 202, enabled: true, sortOrder: 1, postsPerTurn: 1 }
    ]

    let now = new Date(2026, 7, 24, 11, 59, 59)
    const calls: Array<{ accountId: number; hour: number }> = []
    let nextItemId = 1
    const posting = {
      executeSingle: async (payload: { runId: number; accountId?: number }): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        calls.push({ accountId, hour: now.getHours() })
        const run = store.finishOne()
        now = new Date(now.getTime() + 1000)
        return { accountId, item: item(nextItemId++, payload.runId), result: { status: 'success', message: 'ok' }, run }
      }
    }
    const service = new RotationService(store, posting, {
      now: () => now,
      random: () => 0,
      sleep: async (milliseconds) => { now = new Date(now.getTime() + milliseconds) }
    })

    service.start({ pageTabId: 10 })
    await service.waitForSettled()

    expect(calls).toEqual([
      { accountId: 101, hour: 11 },
      { accountId: 101, hour: 13 },
      { accountId: 202, hour: 13 }
    ])
    expect(service.status({ pageTabId: 10 }).status).toBe('waiting_window')
    service.dispose()
  })

  it('carries an incomplete account-cycle cursor into the next same-day window', async () => {
    const store = new FakeRunStore()
    store.details = makeRun(12)
    store.details.run.snapshot.schedules = mondayTwoWindows
    store.details.run.snapshot.rotation.postDelayMinSeconds = 0
    store.details.run.snapshot.rotation.postDelayMaxSeconds = 0
    store.details.run.snapshot.rotation.accountDelayMinSeconds = 0
    store.details.run.snapshot.rotation.accountDelayMaxSeconds = 0
    store.details.run.snapshot.accounts = [101, 202, 303, 404, 505].map((accountId, index) => ({
      accountId,
      enabled: true,
      sortOrder: index,
      postsPerTurn: 1
    }))

    let now = new Date(2026, 7, 24, 11, 59, 57)
    const calls: Array<{ accountId: number; hour: number }> = []
    let nextItemId = 1
    const posting = {
      executeSingle: async (payload: { runId: number; accountId?: number }): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        calls.push({ accountId, hour: now.getHours() })
        const run = store.finishOne()
        now = new Date(now.getTime() + 1000)
        return { accountId, item: item(nextItemId++, payload.runId), result: { status: 'success', message: 'ok' }, run }
      }
    }
    const service = new RotationService(store, posting, {
      now: () => now,
      random: () => 0,
      sleep: async (milliseconds) => { now = new Date(now.getTime() + milliseconds) }
    })

    service.start({ pageTabId: 10 })
    await service.waitForSettled()

    expect(calls).toEqual([
      { accountId: 101, hour: 11 },
      { accountId: 202, hour: 11 },
      { accountId: 303, hour: 11 },
      { accountId: 404, hour: 13 },
      { accountId: 505, hour: 13 }
    ])
    expect(service.status({ pageTabId: 10 }).status).toBe('waiting_window')
    service.dispose()
  })

  it('starts a fresh cycle from the first account in the next window after a full sequential cycle', async () => {
    const store = new FakeRunStore()
    store.details = makeRun(8)
    store.details.run.snapshot.schedules = mondayTwoWindows
    store.details.run.snapshot.rotation.postDelayMinSeconds = 0
    store.details.run.snapshot.rotation.postDelayMaxSeconds = 0
    store.details.run.snapshot.rotation.accountDelayMinSeconds = 0
    store.details.run.snapshot.rotation.accountDelayMaxSeconds = 0
    store.details.run.snapshot.accounts = [
      { accountId: 101, enabled: true, sortOrder: 0, postsPerTurn: 1 },
      { accountId: 202, enabled: true, sortOrder: 1, postsPerTurn: 1 }
    ]

    let now = new Date(2026, 7, 24, 8, 0)
    const accountCalls: number[] = []
    let nextItemId = 1
    let secondCycleStarted!: () => void
    const secondCycle = new Promise<void>((resolve) => { secondCycleStarted = resolve })
    const posting = {
      executeSingle: async (payload: { runId: number; accountId?: number }): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        accountCalls.push(accountId)
        if (accountCalls.length === 3) {
          secondCycleStarted()
          return never()
        }
        const run = store.finishOne()
        return { accountId, item: item(nextItemId++, payload.runId), result: { status: 'success', message: 'ok' }, run }
      }
    }
    const service = new RotationService(store, posting, {
      now: () => now,
      random: () => 0,
      sleep: async (milliseconds) => { now = new Date(now.getTime() + milliseconds) }
    })

    service.start({ pageTabId: 10 })
    await secondCycle

    expect(accountCalls).toEqual([101, 202, 101])
    expect(now.getHours()).toBe(13)
    service.dispose()
  })

  it('randomizes account order once per cycle without repeating an account inside that cycle', async () => {
    const store = new FakeRunStore()
    store.details = makeRun(8)
    store.details.run.snapshot.rotation.accountOrderMode = 'random'
    store.details.run.snapshot.rotation.postDelayMinSeconds = 0
    store.details.run.snapshot.rotation.postDelayMaxSeconds = 0
    store.details.run.snapshot.rotation.accountDelayMinSeconds = 0
    store.details.run.snapshot.rotation.accountDelayMaxSeconds = 0
    store.details.run.snapshot.accounts = [
      { accountId: 101, enabled: true, sortOrder: 0, postsPerTurn: 1 },
      { accountId: 202, enabled: true, sortOrder: 1, postsPerTurn: 1 },
      { accountId: 303, enabled: true, sortOrder: 2, postsPerTurn: 1 }
    ]

    const calls: number[] = []
    let nextItemId = 1
    const posting = {
      executeSingle: async (payload: { runId: number; accountId?: number }): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        calls.push(accountId)
        const run = store.finishOne()
        return { accountId, item: item(nextItemId++, payload.runId), result: { status: 'success', message: 'ok' }, run }
      }
    }
    const service = new RotationService(store, posting, {
      now: () => new Date(2026, 7, 24, 10, 30),
      random: () => 0,
      sleep: async () => never()
    })

    service.start({ pageTabId: 10 })
    await service.waitForSettled()

    expect(calls).toEqual([202, 303, 101])
    expect(new Set(calls).size).toBe(3)
    service.dispose()
  })

  it('does not consume Bài/lượt quota for a terminal failed posting result', async () => {
    const store = new FakeRunStore()
    store.details = makeRun(5)
    store.details.run.snapshot.rotation.postDelayMinSeconds = 0
    store.details.run.snapshot.rotation.postDelayMaxSeconds = 0
    store.details.run.snapshot.rotation.accountDelayMinSeconds = 0
    store.details.run.snapshot.rotation.accountDelayMaxSeconds = 0
    store.details.run.snapshot.accounts = [
      { accountId: 101, enabled: true, sortOrder: 0, postsPerTurn: 2 },
      { accountId: 202, enabled: true, sortOrder: 1, postsPerTurn: 1 }
    ]

    const accountCalls: number[] = []
    let nextItemId = 1
    const posting = {
      executeSingle: async (payload: { runId: number; accountId?: number }): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        accountCalls.push(accountId)
        if (accountId === 101) {
          const run = store.finishOne('failed')
          return {
            accountId,
            item: item(nextItemId++, payload.runId, 'failed'),
            result: { status: 'failed', code: 'composer_not_found', message: 'composer failed' },
            run
          }
        }
        const run = store.finishOne()
        return { accountId, item: item(nextItemId++, payload.runId), result: { status: 'success', message: 'ok' }, run }
      }
    }
    const service = new RotationService(store, posting, {
      now: () => new Date(2026, 7, 24, 10, 30),
      random: () => 0,
      sleep: async () => never()
    })

    service.start({ pageTabId: 10 })
    await service.waitForSettled()

    expect(accountCalls).toEqual([101, 202])
    expect(store.details.metrics.failed).toBe(1)
    expect(store.details.metrics.success).toBe(1)
    service.dispose()
  })

  it('pauses outside the configured window and resumes when the window opens', async () => {
    const store = new FakeRunStore()
    store.details = makeRun(1)
    store.details.run.snapshot.accounts = [{ accountId: 101, enabled: true, sortOrder: 0, postsPerTurn: 1 }]
    store.details.run.snapshot.schedules = [{ dayOfWeek: 1, startMinute: 600, endMinute: 660, enabled: true, sortOrder: 0 }]

    let now = new Date(2026, 7, 24, 9, 59)
    const posting = {
      executeSingle: async (payload: { runId: number; accountId?: number }): Promise<ExecuteSinglePostingJobResult> => {
        const run = store.finishOne()
        return {
          accountId: payload.accountId ?? null,
          item: item(1, payload.runId),
          result: { status: 'success', message: 'ok' },
          run
        }
      }
    }
    const service = new RotationService(store, posting, {
      now: () => now,
      random: () => 0,
      sleep: async (milliseconds) => {
        if (store.details?.run.status === 'completed') return never()
        now = new Date(now.getTime() + milliseconds)
      }
    })

    service.start({ pageTabId: 10 })
    await service.waitForSettled()

    expect(store.pauseCalls).toBeGreaterThan(0)
    expect(store.resumeCalls).toBe(1)
    expect(service.status({ pageTabId: 10 }).status).toBe('waiting_window')
    service.dispose()
  })

  it('uses the latest Page Tab schedule on Resume instead of a stale run snapshot', () => {
    const store = new FakeRunStore()
    store.details = makeRun(1)
    store.details.run.snapshot.accounts = [{ accountId: 101, enabled: true, sortOrder: 0, postsPerTurn: 1 }]
    store.details.run.snapshot.schedules = [{ dayOfWeek: 1, startMinute: 600, endMinute: 660, enabled: true, sortOrder: 0 }]

    const liveSchedules: PageTabScheduleInput[] = [
      { dayOfWeek: 1, startMinute: 460, endMinute: 600, enabled: true, sortOrder: 0 }
    ]
    const posting = {
      executeSingle: async (): Promise<ExecuteSinglePostingJobResult> => new Promise(() => undefined)
    }
    const service = new RotationService(
      store,
      posting,
      {
        now: () => new Date(2026, 7, 24, 7, 50),
        random: () => 0,
        sleep: async () => new Promise(() => undefined)
      },
      undefined,
      undefined,
      () => liveSchedules
    )

    service.start({ pageTabId: 10 })
    const paused = service.pause({ pageTabId: 10 })
    expect(paused.status).toBe('paused')

    const resumed = service.resume({ pageTabId: 10 })
    expect(resumed.status).toBe('running')
    expect(resumed.nextActionAt).toBeNull()
    service.dispose()
  })

  it('restores a paused run and restarts the scheduler when Resume is clicked after app restart', async () => {
    const store = new FakeRunStore()
    store.details = makeRun(1)
    store.details.run.status = 'paused'
    store.details.run.snapshot.accounts = [{ accountId: 101, enabled: true, sortOrder: 0, postsPerTurn: 1 }]
    store.details.run.snapshot.schedules = [{ dayOfWeek: 1, startMinute: 460, endMinute: 600, enabled: true, sortOrder: 0 }]

    const accountCalls: number[] = []
    const posting = {
      executeSingle: async (payload: { runId: number; accountId?: number }): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        accountCalls.push(accountId)
        const run = store.finishOne()
        return {
          accountId,
          item: item(1, payload.runId),
          result: { status: 'success', message: 'ok' },
          run
        }
      }
    }
    const service = new RotationService(store, posting, {
      now: () => new Date(2026, 7, 24, 7, 50),
      random: () => 0,
      sleep: async () => never()
    })

    const resumed = service.resume({ pageTabId: 10 })
    expect(resumed.status).toBe('running')
    expect(resumed.message).toContain('khôi phục')

    await service.waitForSettled()

    expect(accountCalls).toEqual([101])
    expect(store.resumeCalls).toBe(1)
    expect(service.status({ pageTabId: 10 }).status).toBe('waiting_window')
    service.dispose()
  })

  it('defers Stop until an in-flight posting job finishes, then marks the run stopped', async () => {
    const store = new FakeRunStore()
    store.details = makeRun(1)
    store.details.run.snapshot.accounts = [{ accountId: 101, enabled: true, sortOrder: 0, postsPerTurn: 1 }]

    let resolveJob!: () => void
    let jobStarted!: () => void
    const started = new Promise<void>((resolve) => { jobStarted = resolve })
    const posting = {
      executeSingle: (payload: { runId: number; accountId?: number }): Promise<ExecuteSinglePostingJobResult> => {
        jobStarted()
        return new Promise((resolve) => {
          resolveJob = () => {
            const run = store.finishOne()
            resolve({
              accountId: payload.accountId ?? null,
              item: item(1, payload.runId),
              result: { status: 'success', message: 'ok' },
              run
            })
          }
        })
      }
    }
    const service = new RotationService(store, posting, {
      now: () => new Date(2026, 7, 24, 10, 30),
      random: () => 0,
      sleep: async () => undefined
    })

    service.start({ pageTabId: 10 })
    await started
    const stopping = service.stop({ pageTabId: 10 })
    expect(stopping.status).toBe('stopping')
    expect(store.stopCalls).toBe(0)

    resolveJob()
    await service.waitForSettled()
    expect(service.status({ pageTabId: 10 }).status).toBe('stopped')
    expect(store.stopCalls).toBe(1)
  })

  it('creates a fresh run and resets to the first sequential account on the next eligible local day', async () => {
    const store = new FakeRunStore()
    store.details = makeRun(3)
    store.details.run.snapshot.accounts = [
      { accountId: 101, enabled: true, sortOrder: 0, postsPerTurn: 1 },
      { accountId: 202, enabled: true, sortOrder: 1, postsPerTurn: 1 }
    ]
    store.details.run.snapshot.schedules = [
      { dayOfWeek: 1, startMinute: 1438, endMinute: 1439, enabled: true, sortOrder: 0 },
      { dayOfWeek: 2, startMinute: 0, endMinute: 1, enabled: true, sortOrder: 1 }
    ]
    store.details.run.snapshot.rotation.postDelayMinSeconds = 0
    store.details.run.snapshot.rotation.postDelayMaxSeconds = 0
    store.details.run.snapshot.rotation.accountDelayMinSeconds = 0
    store.details.run.snapshot.rotation.accountDelayMaxSeconds = 0

    let now = new Date(2026, 7, 24, 23, 58, 59)
    const calls: Array<{ runId: number; accountId: number }> = []
    let nextItemId = 1
    let secondStarted!: () => void
    const secondRunStarted = new Promise<void>((resolve) => { secondStarted = resolve })
    const posting = {
      executeSingle: (payload: { runId: number; accountId?: number }): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        calls.push({ runId: payload.runId, accountId })
        if (payload.runId === 2) {
          secondStarted()
          return never()
        }
        const run = store.finishOne()
        now = new Date(now.getTime() + 1000)
        return Promise.resolve({
          accountId,
          item: item(nextItemId++, payload.runId),
          result: { status: 'success', message: 'ok' },
          run
        })
      }
    }
    const service = new RotationService(store, posting, {
      now: () => now,
      random: () => 0,
      sleep: async (milliseconds) => { now = new Date(now.getTime() + milliseconds) }
    })

    service.start({ pageTabId: 10 })
    await secondRunStarted

    expect(store.createCalls).toBe(1)
    expect(calls[0]).toEqual({ runId: 1, accountId: 101 })
    expect(calls.at(-1)).toEqual({ runId: 2, accountId: 101 })
    expect(service.status({ pageTabId: 10 }).runId).toBe(2)
    expect(service.status({ pageTabId: 10 }).status).toBe('running')
    service.dispose()
  })
})
