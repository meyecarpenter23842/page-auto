import { describe, expect, it } from 'vitest'
import type { ExecuteSinglePostingJobResult } from '../../shared/posting'
import type { RunDetails, RunItem } from '../../shared/runs'
import { RotationService, type RotationRunStore, type RunStopReason } from './rotationService'

function makeRun(total = 5): RunDetails {
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
          postDelayMinSeconds: 0,
          postDelayMaxSeconds: 0,
          accountDelayMinSeconds: 0,
          accountDelayMaxSeconds: 0,
          accountOrderMode: 'sequential'
        },
        accounts: [
          { accountId: 101, enabled: true, sortOrder: 0, postsPerTurn: 1 },
          { accountId: 202, enabled: true, sortOrder: 1, postsPerTurn: 1 }
        ],
        schedules: [{ dayOfWeek: 1, startMinute: 420, endMinute: 720, enabled: true, sortOrder: 0 }],
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

class Store implements RotationRunStore {
  details = makeRun()
  rotationState: { activeDateKey: string | null; completedWindowKey: string | null } | null = null

  getLatestForPageTab(): RunDetails { return this.details }
  createForPageTab(): RunDetails { return this.details }
  get(): RunDetails { return this.details }
  pause(): RunDetails { this.details.run.status = 'paused'; return this.details }
  resume(): RunDetails { this.details.run.status = 'running'; return this.details }
  stop(_runId: number, _reason?: RunStopReason): RunDetails { this.details.run.status = 'stopped'; return this.details }
  getRotationState(): { activeDateKey: string | null; completedWindowKey: string | null } | null { return this.rotationState }
  saveRotationState(_runId: number, state: { activeDateKey: string | null; completedWindowKey: string | null }): void {
    this.rotationState = { ...state }
  }

  finishOne(status: 'success' | 'failed' | 'skipped'): RunDetails {
    this.details.metrics.pending -= 1
    this.details.metrics.remaining -= 1
    this.details.metrics[status] += 1
    return this.details
  }
}

function item(id: number, status: 'success' | 'failed' | 'skipped'): RunItem {
  return {
    id,
    runId: 1,
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

describe('RotationService review regressions', () => {
  it('runs all remaining groups inside the active window and stays exhausted after service recreation', async () => {
    const store = new Store()
    const now = new Date(2026, 7, 24, 10, 0)
    const firstCalls: number[] = []
    let nextItemId = 1
    const first = new RotationService(store, {
      executeSingle: async (payload): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        firstCalls.push(accountId)
        const run = store.finishOne('success')
        return { accountId, item: item(nextItemId++, 'success'), result: { status: 'success', message: 'ok' }, run }
      }
    }, {
      now: () => now,
      random: () => 0,
      sleep: async () => never()
    })

    first.start({ pageTabId: 10 })
    await first.waitForSettled()
    expect(firstCalls).toEqual([101, 202, 101, 202, 101])
    expect(store.details.metrics.remaining).toBe(0)
    expect(store.rotationState?.completedWindowKey).toBeNull()
    expect(first.status({ pageTabId: 10 }).status).toBe('waiting_window')
    first.dispose()

    const resumedCalls: number[] = []
    const second = new RotationService(store, {
      executeSingle: async (payload): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        resumedCalls.push(accountId)
        const run = store.finishOne('success')
        return { accountId, item: item(nextItemId++, 'success'), result: { status: 'success', message: 'unexpected' }, run }
      }
    }, {
      now: () => now,
      random: () => 0,
      sleep: async () => never()
    })

    const resumed = second.resume({ pageTabId: 10 })
    expect(resumed.status).toBe('waiting_window')
    await Promise.resolve()
    expect(resumedCalls).toEqual([])
    second.dispose()
  })

  it('continues a single-account run after an intentional skipped item without consuming quota', async () => {
    const store = new Store()
    store.details = makeRun(3)
    store.details.run.snapshot.accounts = [{ accountId: 101, enabled: true, sortOrder: 0, postsPerTurn: 1 }]
    store.details.run.snapshot.schedules = []

    const calls: number[] = []
    let attempt = 0
    const service = new RotationService(store, {
      executeSingle: async (payload): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        calls.push(accountId)
        attempt += 1
        if (attempt === 1) {
          const run = store.finishOne('skipped')
          return {
            accountId,
            item: item(1, 'skipped'),
            result: { status: 'skipped', code: 'missing_media', message: 'skip by policy' },
            run
          }
        }
        const run = store.finishOne('success')
        return {
          accountId,
          item: item(attempt, 'success'),
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

    expect(calls).toEqual([101, 101, 101])
    expect(store.details.metrics.skipped).toBe(1)
    expect(store.details.metrics.success).toBe(2)
    expect(store.details.metrics.remaining).toBe(0)
    expect(service.status({ pageTabId: 10 }).status).toBe('waiting_window')
    service.dispose()
  })
})
