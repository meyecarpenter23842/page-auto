import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../shared/appSettings'
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
          accountDelayMinSeconds: 0,
          accountDelayMaxSeconds: 0
        },
        accounts: [
          { accountId: 101, enabled: true, sortOrder: 0, postsPerTurn: 1 },
          { accountId: 202, enabled: true, sortOrder: 1, postsPerTurn: 1 }
        ],
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

class Store implements RotationRunStore {
  details = makeRun()

  getLatestForPageTab(): RunDetails { return this.details }
  createForPageTab(): RunDetails { this.details = makeRun(); return this.details }
  get(): RunDetails { return this.details }
  pause(): RunDetails { this.details.run.status = 'paused'; return this.details }
  resume(): RunDetails { this.details.run.status = 'running'; return this.details }
  stop(_runId: number, _reason?: RunStopReason): RunDetails { this.details.run.status = 'stopped'; return this.details }

  finish(): RunDetails {
    this.details.metrics.pending = 0
    this.details.metrics.success = 1
    this.details.metrics.remaining = 0
    this.details.metrics.progressPercent = 100
    this.details.run.status = 'completed'
    return this.details
  }
}

function item(runId: number): RunItem {
  return {
    id: 1,
    runId,
    sourceGroupItemId: null,
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

describe('RotationService proxy policy', () => {
  it('switches to the next account after proxy preflight failure when configured to abort the account', async () => {
    const store = new Store()
    const accountCalls: number[] = []
    const posting = {
      executeSingle: async (payload: { runId: number; accountId?: number }): Promise<ExecuteSinglePostingJobResult> => {
        const accountId = payload.accountId ?? -1
        accountCalls.push(accountId)
        if (accountId === 101) {
          return {
            accountId,
            item: null,
            result: { status: 'failed', code: 'proxy_unavailable', message: 'Proxy unavailable.' },
            run: store.details
          }
        }
        return {
          accountId,
          item: item(payload.runId),
          result: { status: 'success', message: 'ok' },
          run: store.finish()
        }
      }
    }

    const service = new RotationService(
      store,
      posting,
      {
        now: () => new Date(2026, 7, 24, 10, 30),
        random: () => 0,
        sleep: async () => {
          if (store.details.run.status === 'completed') return new Promise(() => undefined)
        }
      },
      () => ({ ...DEFAULT_APP_SETTINGS.session }),
      () => ({ ...DEFAULT_APP_SETTINGS.network, abortAccountOnProxyFailure: true })
    )

    service.start({ pageTabId: 10 })
    await service.waitForSettled()

    expect(accountCalls).toEqual([101, 202])
    expect(service.status({ pageTabId: 10 }).status).toBe('waiting_window')
    service.dispose()
  })
})
