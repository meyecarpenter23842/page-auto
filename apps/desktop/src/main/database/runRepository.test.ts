import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GroupOrderMode } from '../../shared/pageTabs'
import { AccountRepository } from './accountRepository'
import { initializeDatabase } from './index'
import { PageTabRepository } from './pageTabRepository'
import { RunRepository } from './runRepository'

const tempDirectories: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createRuntime() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-run-db-'))
  tempDirectories.push(directory)
  return initializeDatabase(join(directory, 'page-auto.sqlite'))
}

function configureTab(groupUids: string[], groupOrderMode: GroupOrderMode = 'sequential') {
  const runtime = createRuntime()
  const accounts = new AccountRepository(runtime.client)
  const tabs = new PageTabRepository(runtime.client)
  const runs = new RunRepository(runtime.client)
  const account = accounts.create({ uid: '10001', name: 'Runner', password: 'pass-secret', cookie: 'cookie-secret' })
  const tab = tabs.create({ name: 'Page A', pageUid: '90001' })

  tabs.update(tab.id, {
    name: 'Page A',
    pageUid: '90001',
    rotation: {
      postsPerAccount: 2,
      postDelayMinSeconds: 10,
      postDelayMaxSeconds: 20,
      accountDelayMinSeconds: 30,
      accountDelayMaxSeconds: 40
    },
    accounts: [{ accountId: account.id, enabled: true, sortOrder: 0, postsPerTurn: null }],
    schedules: [{ dayOfWeek: 1, startMinute: 480, endMinute: 720, enabled: true, sortOrder: 0 }],
    groupUids,
    groupOrderMode,
    contentMode: 'sequential',
    contents: ['original content'],
    image: { folderPath: 'D:\\images', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
  })

  return { runtime, tabs, runs, tab }
}

function drainSuccessfully(runs: RunRepository, runId: number): void {
  runs.resume(runId)
  while (runs.metrics(runId).pending > 0) {
    const item = runs.claimNext(runId)
    if (!item) throw new Error('Expected a pending run item.')
    runs.completeItem({ runId, itemId: item.id, status: 'success' })
  }
}

describe('RunRepository', () => {
  it('clones 500+ groups without duplicates, consumes success only in the run, and clones full source again', () => {
    const groupUids = Array.from({ length: 600 }, (_, index) => `group-${index + 1}`)
    const { runtime, tabs, runs, tab } = configureTab(groupUids)

    const firstRun = runs.createForPageTab(tab.id)
    expect(firstRun.metrics).toMatchObject({ total: 600, pending: 600, success: 0, remaining: 600 })
    expect(firstRun.run.snapshot.groupOrderMode).toBe('sequential')

    const firstItems = runs.listItems(firstRun.run.id)
    expect(firstItems).toHaveLength(600)
    expect(new Set(firstItems.map((item) => item.groupUid)).size).toBe(600)
    expect(firstRun.run.snapshot.groupSourceCount).toBe(600)
    expect(JSON.stringify(firstRun.run.snapshot)).not.toContain('pass-secret')
    expect(JSON.stringify(firstRun.run.snapshot)).not.toContain('cookie-secret')

    runs.resume(firstRun.run.id)
    const firstItem = runs.claimNext(firstRun.run.id)
    expect(firstItem?.groupUid).toBe('group-1')
    if (!firstItem) throw new Error('Expected first run item.')
    const afterSuccess = runs.completeItem({ runId: firstRun.run.id, itemId: firstItem.id, status: 'success' })
    expect(afterSuccess.metrics).toMatchObject({ success: 1, pending: 599, remaining: 599 })
    expect(tabs.get(tab.id)?.groupUids).toHaveLength(600)

    drainSuccessfully(runs, firstRun.run.id)
    expect(runs.get(firstRun.run.id)?.run.status).toBe('completed')
    expect(tabs.get(tab.id)?.groupUids).toEqual(groupUids)

    const secondRun = runs.createForPageTab(tab.id)
    expect(secondRun.run.id).not.toBe(firstRun.run.id)
    expect(secondRun.metrics).toMatchObject({ total: 600, pending: 600, success: 0 })
    expect(runs.listItems(secondRun.run.id).map((item) => item.groupUid)).toEqual(groupUids)

    runtime.close()
  }, 15_000)

  it('randomizes only the run_items snapshot and keeps the persisted order across resume/repository restart', () => {
    const groupUids = ['g1', 'g2', 'g3', 'g4']
    const { runtime, tabs, runs, tab } = configureTab(groupUids, 'random')
    vi.spyOn(Math, 'random').mockReturnValue(0)

    const created = runs.createForPageTab(tab.id)
    const randomized = runs.listItems(created.run.id).map((item) => item.groupUid)
    expect(created.run.snapshot.groupOrderMode).toBe('random')
    expect(randomized).toEqual(['g2', 'g3', 'g4', 'g1'])
    expect(tabs.get(tab.id)?.groupUids).toEqual(groupUids)

    runs.resume(created.run.id)
    const first = runs.claimNext(created.run.id)
    expect(first?.groupUid).toBe('g2')
    if (!first) throw new Error('Expected first randomized item.')
    runs.completeItem({ runId: created.run.id, itemId: first.id, status: 'success' })
    runs.pause(created.run.id)

    const restartedRuns = new RunRepository(runtime.client)
    expect(restartedRuns.listItems(created.run.id).map((item) => item.groupUid)).toEqual(randomized)
    restartedRuns.resume(created.run.id)
    const second = restartedRuns.claimNext(created.run.id)
    expect(second?.groupUid).toBe('g3')
    expect(second?.groupUid).not.toBe(first.groupUid)
    expect(restartedRuns.metrics(created.run.id).success).toBe(1)
    expect(tabs.get(tab.id)?.groupUids).toEqual(groupUids)

    runtime.close()
  })

  it('preserves an in-flight processing item across pause/resume and keeps the original snapshot immutable', () => {
    const { runtime, tabs, runs, tab } = configureTab(['g1', 'g2', 'g3'])
    const created = runs.createForPageTab(tab.id)

    expect(() => runs.createForPageTab(tab.id)).toThrow('đang có phiên')
    const running = runs.resume(created.run.id)
    expect(running.run.status).toBe('running')

    const claimed = runs.claimNext(created.run.id)
    expect(claimed?.status).toBe('processing')
    expect(runs.metrics(created.run.id).processing).toBe(1)

    runs.pause(created.run.id)
    const resumed = runs.resume(created.run.id)
    expect(resumed.metrics.processing).toBe(1)
    expect(resumed.metrics.pending).toBe(2)
    expect(resumed.metrics.success).toBe(0)
    expect(runs.listItems(created.run.id)[0]?.attemptCount).toBe(1)

    if (!claimed) throw new Error('Expected claimed run item.')
    runs.completeItem({ runId: created.run.id, itemId: claimed.id, status: 'success' })

    const current = tabs.get(tab.id)
    if (!current) throw new Error('Expected Page Tab config.')
    tabs.update(tab.id, {
      name: current.name,
      pageUid: current.pageUid,
      rotation: current.rotation,
      accounts: current.accounts,
      schedules: current.schedules,
      groupUids: ['new-1', 'new-2'],
      groupOrderMode: current.groupOrderMode ?? 'sequential',
      contentMode: current.contentMode,
      contents: ['changed content'],
      image: current.image
    })

    expect(runs.listItems(created.run.id).map((item) => item.groupUid)).toEqual(['g1', 'g2', 'g3'])
    expect(runs.get(created.run.id)?.run.snapshot.contents).toEqual(['original content'])

    drainSuccessfully(runs, created.run.id)
    const nextRun = runs.createForPageTab(tab.id)
    expect(runs.listItems(nextRun.run.id).map((item) => item.groupUid)).toEqual(['new-1', 'new-2'])
    expect(nextRun.run.snapshot.contents).toEqual(['changed content'])

    runtime.close()
  })

  it('Stop ends the current run and the next Start can clone the original Group Set from the beginning', () => {
    const { runtime, tabs, runs, tab } = configureTab(['g1', 'g2', 'g3'])
    const firstRun = runs.createForPageTab(tab.id)
    runs.resume(firstRun.run.id)

    const claimed = runs.claimNext(firstRun.run.id)
    if (!claimed) throw new Error('Expected first item.')
    runs.completeItem({ runId: firstRun.run.id, itemId: claimed.id, status: 'success' })
    expect(runs.get(firstRun.run.id)?.metrics.success).toBe(1)

    const stopped = runs.stop(firstRun.run.id, 'manual')
    expect(stopped.run.status).toBe('stopped')
    expect(tabs.get(tab.id)?.status).toBe('stopped')
    expect(tabs.get(tab.id)?.groupUids).toEqual(['g1', 'g2', 'g3'])

    const fresh = runs.createForPageTab(tab.id)
    expect(fresh.run.id).not.toBe(firstRun.run.id)
    expect(fresh.metrics).toMatchObject({ total: 3, pending: 3, success: 0, remaining: 3 })
    expect(runs.listItems(fresh.run.id).map((item) => item.groupUid)).toEqual(['g1', 'g2', 'g3'])

    runtime.close()
  })
})
