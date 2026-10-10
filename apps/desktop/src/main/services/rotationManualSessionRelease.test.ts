import { describe, expect, it } from 'vitest'
import type { ExecuteSinglePostingJobResult } from '../../shared/posting'
import type { RunDetails, RunItem } from '../../shared/runs'
import { RotationService, type RotationRunStore, type RunStopReason } from './rotationService'

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
          accountDelayMaxSeconds: 1,
          accountOrderMode: 'sequential'
        },
        accounts: [
          { accountId: 101, enabled: true, sortOrder: 0, postsPerTurn: 1 },
          { accountId: 202, enabled: true, sortOrder: 1, postsPerTurn: 1 }
        ],
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

class FakeRunStore implements RotationRunStore {
  details = makeRun()

  getLatestForPageTab(): RunDetails { return this.details }
  createForPageTab(): RunDetails { return this.details }
  get(): RunDetails { return this.details }
  pause(): RunDetails { this.details.run.status = 'paused'; return this.details }
  resume(): RunDetails { this.details.run.status = 'running'; return this.details }
  stop(_runId: number, _reason?: RunStopReason): RunDetails { this.details.run.status = 'stopped'; return this.details }

  finishSuccess(): RunDetails {
    this.details.metrics.pending -= 1
    this.details.metrics.remaining -= 1
    this.details.metrics.success += 1
    return this.details
  }
}

function successItem(runId: number): RunItem {
  return {
    id: 2,
    runId,
    sourceGroupItemId: null,
    groupUid: 'group-2',
    sortOrder: 2,
    status: 'success',
    attemptCount: 1,
    lastError: null,
    startedAt: 1,
    finishedAt: 2,
    updatedAt: 2
  }
}

function loginFailure(accountId: number, run: RunDetails): ExecuteSinglePostingJobResult {
  return {
    accountId,
    item: null,
    result: {
      status: 'needs_login',
      code: 'needs_login',
      message: 'manual login required',
      sessionValidation: {
        phase: 'before_run',
        state: 'needs_login',
        message: 'manual login required'
      }
    },
    run
  }
}

describe('RotationService account-level login failure lifecycle', () => {
  it('releases the failed account, waits account delay, and continues with the next account', async () => {
    const store = new FakeRunStore()
    const events: string[] = []
    let service!: RotationService

    const posting = {
      executeSingle: async (payload: { runId: number; accountId?: number }): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        events.push(`execute:${accountId}`)
        if (accountId === 101) return loginFailure(accountId, store.details)

        const run = store.finishSuccess()
        return { accountId, item: successItem(payload.runId), result: { status: 'success', message: 'ok' }, run }
      },
      releaseAccount: async (accountId: number): Promise<void> => {
        events.push(`release:${accountId}`)
      }
    }

    service = new RotationService(store, posting, {
      now: () => new Date(2026, 7, 24, 10, 30),
      random: () => 0,
      sleep: async (milliseconds) => {
        if (service.status({ pageTabId: 10 }).status === 'waiting_window') return new Promise<void>(() => undefined)
        events.push(`sleep:${milliseconds}`)
      }
    })

    service.start({ pageTabId: 10 })
    await service.waitForSettled()

    expect(events.slice(0, 4)).toEqual([
      'execute:101',
      'release:101',
      'sleep:1000',
      'execute:202'
    ])
    expect(service.status({ pageTabId: 10 }).status).not.toBe('paused')
    service.dispose()
  })

  it('pauses only after every account in the current cycle is unavailable', async () => {
    const store = new FakeRunStore()
    const calls: number[] = []
    const releases: number[] = []
    let paused!: () => void
    const pausedSignal = new Promise<void>((resolve) => { paused = resolve })
    let service!: RotationService

    const posting = {
      executeSingle: async (payload: { runId: number; accountId?: number }): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        calls.push(accountId)
        return loginFailure(accountId, store.details)
      },
      releaseAccount: async (accountId: number): Promise<void> => {
        releases.push(accountId)
      }
    }

    service = new RotationService(store, posting, {
      now: () => new Date(2026, 7, 24, 10, 30),
      random: () => 0,
      sleep: async (milliseconds) => {
        if (milliseconds === 250 && service.status({ pageTabId: 10 }).status === 'paused') {
          paused()
          return new Promise<void>(() => undefined)
        }
      }
    })

    service.start({ pageTabId: 10 })
    await pausedSignal

    expect(calls).toEqual([101, 202])
    expect(releases).toEqual([101, 202])
    expect(service.status({ pageTabId: 10 }).status).toBe('paused')
    expect(service.status({ pageTabId: 10 }).message).toContain('Không còn tài khoản khả dụng')
    service.dispose()
  })
})
