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
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createRuntime() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-window-state-'))
  tempDirectories.push(directory)
  return initializeDatabase(join(directory, 'page-auto.sqlite'))
}

describe('RunRepository rotation window state', () => {
  it('persists closed-window reason and reads it through a new repository instance', () => {
    const runtime = createRuntime()
    const accounts = new AccountRepository(runtime.client)
    const tabs = new PageTabRepository(runtime.client)
    const runs = new RunRepository(runtime.client)
    const account = accounts.create({ uid: '10001', name: 'Runner' })
    const tab = tabs.create({ name: 'Page A', pageUid: '90001' })

    tabs.update(tab.id, {
      name: tab.name,
      pageUid: tab.pageUid,
      rotation: {
        postsPerAccount: 1,
        postDelayMinSeconds: 0,
        postDelayMaxSeconds: 0,
        accountDelayMinSeconds: 0,
        accountDelayMaxSeconds: 0,
        accountOrderMode: 'sequential'
      },
      accounts: [{ accountId: account.id, enabled: true, sortOrder: 0, postsPerTurn: null }],
      schedules: [],
      groupUids: ['group-1'],
      contentMode: 'sequential',
      contents: ['hello'],
      image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
    })

    const run = runs.createForPageTab(tab.id)
    runs.saveRotationWindowState(run.run.id, {
      dateKey: '2026-08-24',
      activeWindowKey: null,
      closedWindows: [{
        key: '2026-08-24:0:420-720',
        status: 'closed_time_remaining_accounts',
        closedAt: 123456,
        currentAccountId: 101,
        slotsCompletedThisTurn: 1,
        targetSlotsThisTurn: 2,
        groupRemaining: 7
      }]
    })

    const reopened = new RunRepository(runtime.client)
    expect(reopened.getRotationWindowState(run.run.id)).toEqual({
      dateKey: '2026-08-24',
      activeWindowKey: null,
      closedWindows: [{
        key: '2026-08-24:0:420-720',
        status: 'closed_time_remaining_accounts',
        closedAt: 123456,
        currentAccountId: 101,
        slotsCompletedThisTurn: 1,
        targetSlotsThisTurn: 2,
        groupRemaining: 7
      }]
    })

    runtime.close()
  })
})
