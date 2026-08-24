import { describe, expect, it } from 'vitest'
import type { ExecuteSinglePostingJobResult } from '../../shared/posting'
import type { RunDetails, RunItem } from '../../shared/runs'
import { RotationService, type RotationRunStore } from './rotationService'

function makeRun(): RunDetails {
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
          accountDelayMinSeconds: 1,
          accountDelayMaxSeconds: 1
        },
        accounts: [
          { accountId: 101, enabled: true, sortOrder: 0, postsPerTurn: 2 },
          { accountId: 202, enabled: true, sortOrder: 1, postsPerTurn: 1 }
        ],
        schedules: [],
        contentMode: 'sequential',
        contents: ['hello'],
        image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' },
        groupSourceCount: 3
      },
      createdAt: 1,
      startedAt: null,
      pausedAt: null,
      completedAt: null,
      updatedAt: 1
    },
    metrics: {
      total: 3,
      pending: 3,
      processing: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      remaining: 3,
      progressPercent: 0
    }
  }
}

class FakeRunStore implements RotationRunStore {
  details = makeRun()

  getLatestForPageTab(): RunDetails { return this.details }
  createForPageTab(): RunDetails { return this.details }
  get(): RunDetails { return this.details }
  pause(): RunDetails { this.details.run.status = 'paused'; return this.details }
  resume(): RunDetails { this.details.run.status = 'running'; return this.details }
  stop(): RunDetails { this.details.run.status = 'stopped'; return this.details }

  finishOne(): RunDetails {
    this.details.metrics.pending -= 1
    this.details.metrics.remaining -= 1
    this.details.metrics.success += 1
    if (this.details.metrics.remaining === 0) this.details.run.status = 'completed'
    return this.details
  }
}

function item(id: number): RunItem {
  return {
    id,
    runId: 1,
    sourceGroupItemId: null,
    groupUid: `group-${id}`,
    sortOrder: id - 1,
    status: 'success',
    attemptCount: 1,
    lastError: null,
    startedAt: 1,
    finishedAt: 2,
    updatedAt: 2
  }
}

function never(): Promise<void> {
  return new Promise(() => undefined)
}

describe('RotationService account browser lifecycle', () => {
  it('releases the finished account before account-switch delay and before opening the next account', async () => {
    const store = new FakeRunStore()
    const events: string[] = []
    let itemId = 1
    let releaseFinal!: () => void
    const finalReleased = new Promise<void>((resolve) => { releaseFinal = resolve })

    const posting = {
      executeSingle: async (payload: { runId: number; accountId?: number }): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        events.push(`execute:${accountId}`)
        const run = store.finishOne()
        return {
          accountId,
          item: item(itemId++),
          result: { status: 'success', message: 'ok' },
          run
        }
      },
      releaseAccount: async (accountId: number): Promise<void> => {
        events.push(`release:${accountId}`)
        if (accountId === 202) releaseFinal()
      }
    }

    const service = new RotationService(store, posting, {
      now: () => new Date(2026, 7, 24, 10, 30),
      random: () => 0,
      sleep: async (milliseconds) => {
        if (store.details.run.status === 'completed') return never()
        events.push(`delay:${milliseconds}`)
      }
    })

    service.start({ pageTabId: 10 })
    await finalReleased

    expect(events).toEqual([
      'execute:101',
      'execute:101',
      'release:101',
      'delay:1000',
      'execute:202',
      'release:202'
    ])
    service.dispose()
  })
})
