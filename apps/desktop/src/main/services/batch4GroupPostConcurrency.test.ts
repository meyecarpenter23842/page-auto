import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountRepository } from '../database/accountRepository'
import { initializeDatabase } from '../database/index'
import { PageTabRepository } from '../database/pageTabRepository'
import { RunRepository } from '../database/runRepository'
import { AccountExecutionCoordinator } from './accountExecutionCoordinator'
import { ParallelRotationService } from './parallelRotationService'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup(accountConcurrency = 2, groupCount = 8) {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-batch4-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  const accounts = new AccountRepository(runtime.client)
  const tabs = new PageTabRepository(runtime.client)
  const runs = new RunRepository(runtime.client)
  const accountIds = ['11001', '11002', '11003'].map((uid) => accounts.create({ uid, name: `Runner ${uid}` }).id)
  const tab = tabs.create({ name: 'Batch 4 Page', pageUid: '99001' })
  const saved = tabs.update(tab.id, {
    name: tab.name,
    pageUid: tab.pageUid,
    rotation: {
      postsPerAccount: 1,
      postDelayMinSeconds: 0,
      postDelayMaxSeconds: 0,
      accountDelayMinSeconds: 0,
      accountDelayMaxSeconds: 0,
      accountConcurrency
    },
    accounts: accountIds.map((accountId, sortOrder) => ({ accountId, enabled: true, sortOrder, postsPerTurn: 1 })),
    schedules: [],
    groupUids: Array.from({ length: groupCount }, (_, index) => `batch4-group-${index + 1}`),
    groupOrderMode: 'sequential',
    contentMode: 'sequential',
    contents: ['batch4'],
    image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
  })
  return { runtime, accounts, tabs, runs, tab: saved, accountIds }
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Batch 4 concurrency condition.')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('Issue #263 Batch 4 group_post concurrency', () => {
  it('keeps legacy/default concurrency at 1 and persists a configured value', () => {
    const { runtime, tabs, tab } = setup(3)
    expect(tab.rotation.accountConcurrency).toBe(3)

    const legacyLike = tabs.create({ name: 'Legacy Page', pageUid: '99002' })
    expect(legacyLike.rotation.accountConcurrency).toBe(1)
    runtime.close()
  })

  it('claims distinct Groups atomically, enforces owner mutations and releases claims on Stop', () => {
    const { runtime, tabs, runs, tab, accountIds } = setup(2, 4)
    const [accountA, accountB] = accountIds
    if (!accountA || !accountB) throw new Error('Expected two accounts.')

    const created = runs.createForPageTab(tab.id)
    runs.resume(created.run.id)
    const first = runs.claimNext(created.run.id, accountA)
    const second = runs.claimNext(created.run.id, accountB)
    expect(first?.groupUid).not.toBe(second?.groupUid)
    expect(first?.claimedByAccountId).toBe(accountA)
    expect(second?.claimedByAccountId).toBe(accountB)
    if (!first || !second) throw new Error('Expected two claimed Groups.')

    expect(() => runs.completeItem({ runId: created.run.id, itemId: first.id, accountId: accountB, status: 'success' }))
      .toThrow('claim không thuộc account hiện tại')
    runs.completeItem({ runId: created.run.id, itemId: first.id, accountId: accountA, status: 'success' })

    const stopped = runs.stop(created.run.id, 'manual')
    expect(stopped.run.status).toBe('stopped')
    const released = runs.listItems(created.run.id).find((item) => item.id === second.id)
    expect(released).toMatchObject({ status: 'pending', claimedByAccountId: null })
    expect(tabs.get(tab.id)?.groupUids).toEqual(['batch4-group-1', 'batch4-group-2', 'batch4-group-3', 'batch4-group-4'])
    runtime.close()
  })

  it('uses rolling refill and does not let a globally locked account occupy a Page Tab slot', async () => {
    const { runtime, runs, tab, accountIds } = setup(2, 6)
    const [lockedAccount] = accountIds
    if (!lockedAccount) throw new Error('Expected locked account.')
    const coordinator = new AccountExecutionCoordinator()
    const externalLease = coordinator.tryAcquireLease(lockedAccount)
    if (!externalLease) throw new Error('Expected external account lease.')

    let active = 0
    let maxActive = 0
    const startedAccounts: number[] = []
    const claimedGroups: string[] = []
    const posting = {
      executeSingle: async ({ runId, accountId }: { runId: number; accountId?: number }) => {
        if (!accountId) throw new Error('Expected Page Tab accountId.')
        const item = runs.claimNext(runId, accountId)
        const current = runs.get(runId)
        if (!current) throw new Error('Expected current run.')
        if (!item) return { accountId, item: null, result: { status: 'failed' as const, code: 'no_pending_item' as const, message: 'empty' }, run: current }
        active += 1
        maxActive = Math.max(maxActive, active)
        startedAccounts.push(accountId)
        claimedGroups.push(item.groupUid)
        await new Promise((resolve) => setTimeout(resolve, 20))
        active -= 1
        const run = runs.completeItem({ runId, itemId: item.id, accountId, status: 'success' })
        return { accountId, item, result: { status: 'success' as const, message: 'ok' }, run }
      },
      releaseAccount: async () => undefined
    }

    const rotation = new ParallelRotationService(runs, posting, coordinator)
    rotation.start({ pageTabId: tab.id })
    await until(() => startedAccounts.length >= 2)
    expect(startedAccounts.slice(0, 2)).not.toContain(lockedAccount)
    expect(maxActive).toBe(2)

    externalLease.release()
    await rotation.waitForSettled()
    expect(startedAccounts).toContain(lockedAccount)
    expect(new Set(claimedGroups).size).toBe(claimedGroups.length)
    expect(maxActive).toBe(2)
    rotation.dispose()
    runtime.close()
  })
})
