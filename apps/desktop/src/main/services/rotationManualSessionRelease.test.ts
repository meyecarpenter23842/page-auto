import { describe, expect, it } from 'vitest'
import type { ExecuteSinglePostingJobResult } from '../../shared/posting'
import type { RunDetails } from '../../shared/runs'
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
          accountDelayMinSeconds: 0,
          accountDelayMaxSeconds: 0
        },
        accounts: [{ accountId: 101, enabled: true, sortOrder: 0, postsPerTurn: 1 }],
        schedules: [],
        contentMode: 'sequential',
        contents: ['hello'],
        image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' },
        groupSourceCount: 1
      },
      createdAt: 1,
      startedAt: null,
      pausedAt: null,
      completedAt: null,
      updatedAt: 1
    },
    metrics: {
      total: 1,
      pending: 1,
      processing: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      remaining: 1,
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
}

function never(): Promise<void> {
  return new Promise(() => undefined)
}

describe('RotationService retained manual-session lifecycle', () => {
  it('releases the account turn once, then holds the paused tab without re-releasing the retained browser', async () => {
    const store = new FakeRunStore()
    const releases: number[] = []
    let pauseLoopReached!: () => void
    const pausedLoop = new Promise<void>((resolve) => { pauseLoopReached = resolve })

    const posting = {
      executeSingle: async (payload: { runId: number; accountId?: number }): Promise<ExecuteSinglePostingJobResult> => ({
        accountId: payload.accountId ?? null,
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
        run: store.details
      }),
      releaseAccount: async (accountId: number): Promise<void> => {
        releases.push(accountId)
      }
    }

    let service!: RotationService
    service = new RotationService(store, posting, {
      now: () => new Date(2026, 7, 24, 10, 30),
      random: () => 0,
      sleep: async (milliseconds) => {
        if (milliseconds === 250 && service.status({ pageTabId: 10 }).status === 'paused') {
          pauseLoopReached()
          return never()
        }
      }
    })

    service.start({ pageTabId: 10 })
    await pausedLoop

    expect(service.status({ pageTabId: 10 }).status).toBe('paused')
    expect(service.status({ pageTabId: 10 }).currentAccountId).toBeNull()
    expect(releases).toEqual([101])
    service.dispose()
  })
})
