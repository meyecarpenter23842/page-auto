import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountRepository } from '../database/accountRepository'
import { ExecutionLogRepository } from '../database/executionLogRepository'
import { initializeDatabase } from '../database'
import { PageTabRepository } from '../database/pageTabRepository'
import { RunRepository } from '../database/runRepository'
import { RuntimeRecoveryService } from './runtimeRecovery'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createFixture(groupUids: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-recovery-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  const accounts = new AccountRepository(runtime.client)
  const tabs = new PageTabRepository(runtime.client)
  const runs = new RunRepository(runtime.client)
  const logs = new ExecutionLogRepository(runtime.client)
  const recovery = new RuntimeRecoveryService(runtime.client, logs)
  const account = accounts.create({ uid: '80001', name: 'Recovery account' })
  const tab = tabs.create({ name: 'Recovery Page', pageUid: '90001' })
  tabs.update(tab.id, {
    name: tab.name,
    pageUid: tab.pageUid,
    rotation: tab.rotation,
    accounts: [{ accountId: account.id, enabled: true, sortOrder: 0, postsPerTurn: 1 }],
    schedules: [],
    groupUids,
    contentMode: 'sequential',
    contents: ['hello'],
    image: tab.image
  })
  return { runtime, account, tab, runs, logs, recovery }
}

describe('RuntimeRecoveryService', () => {
  it('pauses crashed running runs and moves processing items to manual review without touching pending queue', () => {
    const { runtime, tab, runs, logs, recovery } = createFixture(['g1', 'g2'])
    const created = runs.createForPageTab(tab.id)
    runs.resume(created.run.id)
    const claimed = runs.claimNext(created.run.id)
    if (!claimed) throw new Error('Expected claimed item')

    const summary = recovery.recoverInterruptedRuns()
    expect(summary).toEqual({ pausedRuns: 1, reviewItems: 1 })
    expect(runs.get(created.run.id)?.run.status).toBe('paused')
    expect(runs.listItems(created.run.id).map((item) => item.status)).toEqual(['failed', 'pending'])

    const recoveryLog = logs.getLatestForRunItem(claimed.id)
    expect(recoveryLog).toMatchObject({
      action: 'recovery',
      errorCode: 'recovery_unconfirmed',
      retryDisposition: 'manual_review'
    })
    expect(() => recovery.retryFailedItem(claimed.id)).toThrow('review')
    runtime.close()
  })

  it('closes an exhausted interrupted run instead of leaving an empty paused run', () => {
    const { runtime, tab, runs, recovery } = createFixture(['g1'])
    const created = runs.createForPageTab(tab.id)
    runs.resume(created.run.id)
    const claimed = runs.claimNext(created.run.id)
    if (!claimed) throw new Error('Expected claimed item')

    expect(recovery.recoverInterruptedRuns()).toEqual({ pausedRuns: 0, reviewItems: 1 })
    expect(runs.get(created.run.id)?.run.status).toBe('completed')
    expect(runs.get(created.run.id)?.metrics).toMatchObject({ failed: 1, remaining: 0 })
    runtime.close()
  })

  it('allows a safe pre-publish navigation failure to be queued again and reopens a completed run as paused', () => {
    const { runtime, account, tab, runs, logs, recovery } = createFixture(['g1'])
    const created = runs.createForPageTab(tab.id)
    runs.resume(created.run.id)
    const claimed = runs.claimNext(created.run.id)
    if (!claimed) throw new Error('Expected claimed item')
    runs.completeItem({ runId: created.run.id, itemId: claimed.id, status: 'failed', errorMessage: 'page navigation failed' })
    expect(runs.get(created.run.id)?.run.status).toBe('completed')

    logs.insert({
      runId: created.run.id,
      runItemId: claimed.id,
      pageTabId: tab.id,
      accountId: account.id,
      pageUid: tab.pageUid,
      groupUid: claimed.groupUid,
      contentIndex: 1,
      imagePaths: [],
      action: 'posting_attempt',
      result: 'failed',
      errorCode: 'page_navigation_failed',
      errorMessage: 'page navigation failed',
      screenshotPath: null,
      publishedUrl: null,
      attemptCount: claimed.attemptCount,
      retryDisposition: 'retryable'
    })

    const retried = recovery.retryFailedItem(claimed.id)
    expect(retried.run.run.status).toBe('paused')
    expect(runs.listItems(created.run.id)[0]).toMatchObject({ status: 'pending', attemptCount: 1 })
    runtime.close()
  })

  it('repairs latest run items previously burned by profile_in_use because publish never started', () => {
    const { runtime, account, tab, runs, logs, recovery } = createFixture(['g1'])
    const created = runs.createForPageTab(tab.id)
    runs.resume(created.run.id)
    const claimed = runs.claimNext(created.run.id)
    if (!claimed) throw new Error('Expected claimed item')

    runs.completeItem({
      runId: created.run.id,
      itemId: claimed.id,
      status: 'failed',
      errorMessage: 'Browser profile đang được mở ở process khác.'
    })
    logs.insert({
      runId: created.run.id,
      runItemId: claimed.id,
      pageTabId: tab.id,
      accountId: account.id,
      pageUid: tab.pageUid,
      groupUid: claimed.groupUid,
      contentIndex: 1,
      imagePaths: [],
      action: 'posting_attempt',
      result: 'failed',
      errorCode: 'profile_in_use',
      errorMessage: 'Browser profile đang được mở ở process khác.',
      screenshotPath: null,
      publishedUrl: null,
      attemptCount: claimed.attemptCount,
      retryDisposition: 'retryable'
    })

    expect(runs.get(created.run.id)?.run.status).toBe('completed')
    expect(recovery.recoverInterruptedRuns()).toEqual({ pausedRuns: 0, reviewItems: 0 })
    expect(runs.get(created.run.id)?.run.status).toBe('paused')
    expect(runs.listItems(created.run.id)[0]).toMatchObject({ status: 'pending', attemptCount: 1 })
    runtime.close()
  })

  it('preserves a browser launch failure as pending even after normal retry limits are exhausted', () => {
    const { runtime, account, tab, runs, logs, recovery } = createFixture(['g1'])
    const created = runs.createForPageTab(tab.id)
    runs.resume(created.run.id)
    const claimed = runs.claimNext(created.run.id)
    if (!claimed) throw new Error('Expected claimed item')

    runs.completeItem({
      runId: created.run.id,
      itemId: claimed.id,
      status: 'failed',
      errorMessage: 'Chrome launch failed'
    })
    logs.insert({
      runId: created.run.id,
      runItemId: claimed.id,
      pageTabId: tab.id,
      accountId: account.id,
      pageUid: tab.pageUid,
      groupUid: claimed.groupUid,
      contentIndex: 1,
      imagePaths: [],
      action: 'posting_attempt',
      result: 'failed',
      errorCode: 'browser_launch_failed',
      errorMessage: 'Chrome launch failed',
      screenshotPath: null,
      publishedUrl: null,
      attemptCount: 99,
      retryDisposition: 'retryable'
    })

    const restored = recovery.requeueSafePrepublishFailure(claimed.id)
    expect(restored.run.run.status).toBe('paused')
    expect(runs.listItems(created.run.id)[0]).toMatchObject({ status: 'pending' })
    runtime.close()
  })
})
