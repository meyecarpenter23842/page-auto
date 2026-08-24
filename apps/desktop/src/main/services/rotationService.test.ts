import { describe, expect, it } from 'vitest'
import type { PageTabScheduleInput } from '../../shared/pageTabs'
import type { ExecuteSinglePostingJobResult } from '../../shared/posting'
import type { RunDetails, RunItem } from '../../shared/runs'
import { RotationService, type RotationRunStore } from './rotationService'

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
          accountDelayMaxSeconds: 1
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

  getLatestForPageTab(): RunDetails | null {
    return this.details
  }

  createForPageTab(): RunDetails {
    this.details = makeRun()
    return this.details
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

function item(id: number, runId: number): RunItem {
  return {
    id,
    runId,
    sourceGroupItemId: null,
    groupUid: `group-${id}`,
    sortOrder: id,
    status: 'success',
    attemptCount: 1,
    lastError: null,
    startedAt: 1,
    finishedAt: 2,
    updatedAt: 2
  }
}

describe('RotationService', () => {
  it('loops enabled accounts in order and honors per-account post quotas and delays', async () => {
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
      sleep: async (milliseconds) => { sleeps.push(milliseconds) }
    })

    service.start({ pageTabId: 10 })
    await service.waitForSettled()

    expect(accountCalls).toEqual([101, 101, 202, 101, 101, 202, 101])
    expect(sleeps).toEqual([1000, 1000, 1000, 1000, 1000, 1000])
    expect(service.status({ pageTabId: 10 }).status).toBe('completed')
    expect(store.resumeCalls).toBe(1)
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
      sleep: async (milliseconds) => { now = new Date(now.getTime() + milliseconds) }
    })

    service.start({ pageTabId: 10 })
    await service.waitForSettled()

    expect(store.pauseCalls).toBeGreaterThan(0)
    expect(store.resumeCalls).toBe(1)
    expect(service.status({ pageTabId: 10 }).status).toBe('completed')
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
      sleep: async () => undefined
    })

    const resumed = service.resume({ pageTabId: 10 })
    expect(resumed.status).toBe('running')
    expect(resumed.message).toContain('khôi phục')

    await service.waitForSettled()

    expect(accountCalls).toEqual([101])
    expect(store.resumeCalls).toBe(1)
    expect(service.status({ pageTabId: 10 }).status).toBe('completed')
  })
})
