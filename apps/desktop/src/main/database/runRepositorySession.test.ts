import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountRepository } from './accountRepository'
import { initializeDatabase } from './index'
import { PageTabRepository } from './pageTabRepository'
import { RunRepository } from './runRepository'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-session-release-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  const accounts = new AccountRepository(runtime.client)
  const tabs = new PageTabRepository(runtime.client)
  const runs = new RunRepository(runtime.client)
  const account = accounts.create({ uid: '10001' })
  const tab = tabs.create({ name: 'Page A', pageUid: '90001' })

  tabs.update(tab.id, {
    name: tab.name,
    pageUid: tab.pageUid,
    rotation: tab.rotation,
    accounts: [{ accountId: account.id, enabled: true, sortOrder: 0, postsPerTurn: null }],
    schedules: [],
    groupUids: ['group-1'],
    contentMode: 'sequential',
    contents: ['hello'],
    image: tab.image
  })

  return { runtime, runs, tab }
}

describe('RunRepository session preflight release', () => {
  it('returns a claimed group to pending when session validation fails before posting', () => {
    const { runtime, runs, tab } = setup()
    const run = runs.createForPageTab(tab.id)
    runs.resume(run.run.id)
    const claimed = runs.claimNext(run.run.id)
    expect(claimed?.status).toBe('processing')
    if (!claimed) throw new Error('Expected claimed item.')

    const released = runs.releaseItem({
      runId: run.run.id,
      itemId: claimed.id,
      errorMessage: 'Session expired before posting.'
    })

    expect(released.metrics).toMatchObject({ pending: 1, processing: 0, success: 0, failed: 0, remaining: 1 })
    expect(runs.listItems(run.run.id)[0]).toMatchObject({
      status: 'pending',
      attemptCount: 1,
      lastError: 'Session expired before posting.',
      startedAt: null,
      finishedAt: null
    })

    const reclaimed = runs.claimNext(run.run.id)
    expect(reclaimed?.id).toBe(claimed.id)
    expect(reclaimed?.attemptCount).toBe(2)
    runtime.close()
  })
})