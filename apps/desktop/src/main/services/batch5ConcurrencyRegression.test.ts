import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserLaunchGate, type LaunchGateClock } from '../browser/runtimeLaunchGate'
import { AccountRepository } from '../database/accountRepository'
import { ExecutionLogRepository } from '../database/executionLogRepository'
import { initializeDatabase } from '../database/index'
import { PageTabRepository } from '../database/pageTabRepository'
import { RunRepository } from '../database/runRepository'
import { AccountExecutionCoordinator } from './accountExecutionCoordinator'
import { ParallelRotationService } from './parallelRotationService'
import { RotationService, type RotationPostingExecutor } from './rotationService'
import { RuntimeRecoveryService } from './runtimeRecovery'

const tempDirectories: string[] = []
const runtimes: ReturnType<typeof initializeDatabase>[] = []

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close()
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup(accountConcurrency = 1, accountCount = 2, groupCount = 2) {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-batch5-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  runtimes.push(runtime)
  const accounts = new AccountRepository(runtime.client)
  const tabs = new PageTabRepository(runtime.client)
  const runs = new RunRepository(runtime.client)
  const accountIds = Array.from({ length: accountCount }, (_, index) => accounts.create({
    uid: `batch5-account-${index + 1}`,
    name: `Batch 5 Runner ${index + 1}`
  }).id)
  const tab = tabs.create({ name: 'Batch 5 Page', pageUid: 'batch5-page' })
  const saved = tabs.update(tab.id, {
    name: tab.name,
    pageUid: tab.pageUid,
    rotation: {
      ...tab.rotation,
      postsPerAccount: 1,
      postDelayMinSeconds: 0,
      postDelayMaxSeconds: 0,
      accountDelayMinSeconds: 0,
      accountDelayMaxSeconds: 0,
      accountConcurrency
    },
    accounts: accountIds.map((accountId, sortOrder) => ({ accountId, enabled: true, sortOrder, postsPerTurn: 1 })),
    schedules: [],
    groupUids: Array.from({ length: groupCount }, (_, index) => `batch5-group-${index + 1}`),
    groupOrderMode: 'sequential',
    contentMode: 'sequential',
    contents: ['batch5'],
    image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
  })
  return { runtime, tabs, runs, tab: saved, accountIds }
}

function successfulPosting(
  runs: RunRepository,
  startedAccounts: number[],
  claimedGroups: string[] = []
): RotationPostingExecutor {
  return {
    executeSingle: async ({ runId, accountId }) => {
      if (accountId === undefined) throw new Error('Expected accountId.')
      startedAccounts.push(accountId)
      const item = runs.claimNext(runId, accountId)
      const current = runs.get(runId)
      if (!current) throw new Error('Expected active run.')
      if (!item) {
        return {
          accountId,
          item: null,
          result: { status: 'failed' as const, code: 'no_pending_item' as const, message: 'No pending Group.' },
          run: current
        }
      }
      claimedGroups.push(item.groupUid)
      const run = runs.completeItem({ runId, itemId: item.id, accountId, status: 'success' })
      return { accountId, item, result: { status: 'success' as const, message: 'ok' }, run }
    },
    releaseAccount: async () => undefined
  }
}

describe('Issue #263 Batch 5 regression matrix', () => {
  it('keeps legacy serial concurrency=1 behind the global AccountExecutionCoordinator', async () => {
    const { runs, tab, accountIds } = setup(1, 2, 2)
    const [lockedAccount] = accountIds
    if (lockedAccount === undefined) throw new Error('Expected account.')
    const coordinator = new AccountExecutionCoordinator()
    const externalLease = coordinator.tryAcquireLease(lockedAccount)
    if (!externalLease) throw new Error('Expected external lease.')
    const startedAccounts: number[] = []
    const claimedGroups: string[] = []
    const rotation = new RotationService(
      runs,
      successfulPosting(runs, startedAccounts, claimedGroups),
      undefined,
      undefined,
      undefined,
      () => tab.schedules,
      () => 1,
      coordinator
    )

    try {
      rotation.start({ pageTabId: tab.id })
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(startedAccounts).toEqual([])

      externalLease.release()
      await rotation.waitForSettled()
      expect(startedAccounts).toEqual(accountIds)
      expect(new Set(claimedGroups).size).toBe(claimedGroups.length)
    } finally {
      externalLease.release()
      rotation.dispose()
    }
  })

  it('pauses and settles when every parallel account becomes unavailable instead of closing the account cycle', async () => {
    const { runs, tab, accountIds } = setup(2, 2, 2)
    const coordinator = new AccountExecutionCoordinator()
    const attemptedAccounts: number[] = []
    const posting: RotationPostingExecutor = {
      executeSingle: async ({ runId, accountId }) => {
        if (accountId === undefined) throw new Error('Expected accountId.')
        attemptedAccounts.push(accountId)
        const run = runs.get(runId)
        if (!run) throw new Error('Expected active run.')
        return {
          accountId,
          item: null,
          result: { status: 'failed' as const, code: 'needs_login' as const, message: 'Login required.' },
          run
        }
      },
      releaseAccount: async () => undefined
    }
    const rotation = new ParallelRotationService(runs, posting, coordinator)

    rotation.start({ pageTabId: tab.id })
    await rotation.waitForSettled()
    const status = rotation.status({ pageTabId: tab.id })

    expect(status.status).toBe('paused')
    expect(status.cycle).toBe(0)
    expect(status.run?.run.status).toBe('paused')
    expect([...attemptedAccounts].sort((a, b) => a - b)).toEqual([...accountIds].sort((a, b) => a - b))
    expect(status.message).toContain('Không còn tài khoản khả dụng')
    rotation.dispose()
  })

  it('requeues session-unavailable parallel turns on Resume so repaired accounts are revalidated', async () => {
    const { runs, tab, accountIds } = setup(2, 2, 2)
    const attemptedAccounts: number[] = []
    const claimedGroups: string[] = []
    let credentialsRepaired = false
    const posting: RotationPostingExecutor = {
      executeSingle: async ({ runId, accountId }) => {
        if (accountId === undefined) throw new Error('Expected accountId.')
        attemptedAccounts.push(accountId)
        if (!credentialsRepaired) {
          const run = runs.get(runId)
          if (!run) throw new Error('Expected active run.')
          return {
            accountId,
            item: null,
            result: { status: 'failed' as const, code: 'needs_login' as const, message: 'Login required.' },
            run
          }
        }
        return successfulPosting(runs, [], claimedGroups).executeSingle({ runId, accountId })
      },
      releaseAccount: async () => undefined
    }
    const rotation = new ParallelRotationService(runs, posting, new AccountExecutionCoordinator())

    rotation.start({ pageTabId: tab.id })
    await rotation.waitForSettled()
    expect(rotation.status({ pageTabId: tab.id }).status).toBe('paused')
    expect(attemptedAccounts).toHaveLength(2)

    credentialsRepaired = true
    const resumed = rotation.resume({ pageTabId: tab.id })
    expect(resumed.message).toContain('credential canonical mới nhất')
    await rotation.waitForSettled()

    expect(attemptedAccounts).toHaveLength(4)
    expect(new Set(attemptedAccounts.slice(2))).toEqual(new Set(accountIds))
    expect(new Set(claimedGroups).size).toBe(2)
    expect(rotation.status({ pageTabId: tab.id }).cycle).toBe(1)
    rotation.dispose()
  })

  it('clears a crashed Group claim owner while preserving the immutable source Group list', () => {
    const { runtime, tabs, runs, tab, accountIds } = setup(2, 1, 2)
    const [accountId] = accountIds
    if (accountId === undefined) throw new Error('Expected account.')
    const logs = new ExecutionLogRepository(runtime.client)
    const recovery = new RuntimeRecoveryService(runtime.client, logs)
    const created = runs.createForPageTab(tab.id)
    runs.resume(created.run.id)
    const claimed = runs.claimNext(created.run.id, accountId)
    if (!claimed) throw new Error('Expected claimed Group.')
    expect(claimed.claimedByAccountId).toBe(accountId)

    expect(recovery.recoverInterruptedRuns()).toEqual({ pausedRuns: 1, reviewItems: 1 })
    expect(runs.listItems(created.run.id).find((item) => item.id === claimed.id)).toMatchObject({
      status: 'failed',
      claimedByAccountId: null
    })
    expect(tabs.get(tab.id)?.groupUids).toEqual(['batch5-group-1', 'batch5-group-2'])
  })

  it('keeps launch spacing serialized even when five account slots request Chrome concurrently', async () => {
    let now = 1_000
    const sleeps: number[] = []
    const clock: LaunchGateClock = {
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        now += milliseconds
      }
    }
    const gate = new BrowserLaunchGate(clock)

    await Promise.all(Array.from({ length: 5 }, () => gate.wait(1_500)))

    expect(sleeps).toEqual([1_500, 1_500, 1_500, 1_500])
    expect(now).toBe(7_000)
  })
})