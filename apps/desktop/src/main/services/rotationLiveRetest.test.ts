import { describe, expect, it } from 'vitest'
import type { ExecuteSinglePostingJobResult } from '../../shared/posting'
import type { RunDetails, RunItem } from '../../shared/runs'
import { RotationService, type RotationRunStore, type RunStopReason } from './rotationService'

function makeRun(): RunDetails {
  return {
    run: {
      id: 91,
      pageTabId: 10,
      status: 'created',
      tabName: 'Live retest',
      pageUid: '90001',
      snapshot: {
        version: 1,
        pageTabId: 10,
        tabName: 'Live retest',
        pageUid: '90001',
        rotation: {
          postsPerAccount: 1,
          postDelayMinSeconds: 0,
          postDelayMaxSeconds: 0,
          accountDelayMinSeconds: 0,
          accountDelayMaxSeconds: 0,
          accountOrderMode: 'sequential'
        },
        accounts: [{ accountId: 101, enabled: true, sortOrder: 0, postsPerTurn: 1 }],
        schedules: [],
        contentMode: 'sequential',
        contents: ['hello'],
        image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' },
        groupSourceCount: 2
      },
      createdAt: 1,
      startedAt: null,
      pausedAt: null,
      completedAt: null,
      updatedAt: 1
    },
    metrics: {
      total: 2,
      pending: 2,
      processing: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      remaining: 2,
      progressPercent: 0
    }
  }
}

class Store implements RotationRunStore {
  details = makeRun()
  pauseCalls = 0

  getLatestForPageTab(): RunDetails { return this.details }
  createForPageTab(): RunDetails { return this.details }
  get(): RunDetails { return this.details }
  pause(): RunDetails { this.pauseCalls += 1; this.details.run.status = 'paused'; return this.details }
  resume(): RunDetails { this.details.run.status = 'running'; return this.details }
  stop(_runId: number, _reason?: RunStopReason): RunDetails { this.details.run.status = 'stopped'; return this.details }

  failOne(): RunDetails {
    this.details.metrics.pending -= 1
    this.details.metrics.remaining -= 1
    this.details.metrics.failed += 1
    this.details.metrics.progressPercent = Math.round((this.details.metrics.failed / this.details.metrics.total) * 100)
    return this.details
  }
}

function failedItem(id: number): RunItem {
  return {
    id,
    runId: 91,
    sourceGroupItemId: null,
    groupUid: `group-${id}`,
    sortOrder: id,
    status: 'failed',
    attemptCount: 1,
    lastError: 'composer failed',
    startedAt: 1,
    finishedAt: 2,
    updatedAt: 2
  }
}

describe('RotationService live-retest regressions', () => {
  it('keeps using the only account for remaining groups after terminal composer failures without marking it unavailable', async () => {
    const store = new Store()
    const releaseCalls: number[] = []
    let nextItemId = 500

    const service = new RotationService(store, {
      executeSingle: async (): Promise<ExecuteSinglePostingJobResult> => ({
        accountId: 101,
        item: failedItem(nextItemId++),
        result: { status: 'failed', code: 'composer_not_found', message: 'composer failed' },
        run: store.failOne()
      }),
      releaseAccount: async (accountId: number) => {
        releaseCalls.push(accountId)
      }
    }, {
      now: () => new Date(2026, 7, 25, 8, 0),
      random: () => 0,
      sleep: async () => new Promise<void>(() => undefined)
    })

    service.start({ pageTabId: 10 })
    await service.waitForSettled()

    const status = service.status({ pageTabId: 10 })
    expect(status.status).toBe('waiting_window')
    expect(status.message).not.toContain('Không còn tài khoản khả dụng')
    expect(store.details.metrics.failed).toBe(2)
    expect(store.details.metrics.remaining).toBe(0)
    expect(releaseCalls).toEqual([101, 101])
    service.dispose()
  })
})
