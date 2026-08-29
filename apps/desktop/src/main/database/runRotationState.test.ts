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
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-rotation-state-'))
  tempDirectories.push(directory)
  return initializeDatabase(join(directory, 'page-auto.sqlite'))
}

describe('RunRepository rotation state', () => {
  it('persists the latest schedule-window state in run events', () => {
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
    expect(runs.getRotationState(run.run.id)).toBeNull()

    runs.saveRotationState(run.run.id, {
      activeDateKey: '2026-08-24',
      completedWindowKey: '2026-08-24:0:420-720'
    })
    expect(runs.getRotationState(run.run.id)).toEqual({
      activeDateKey: '2026-08-24',
      completedWindowKey: '2026-08-24:0:420-720'
    })

    runs.saveRotationState(run.run.id, {
      activeDateKey: '2026-08-24',
      completedWindowKey: null
    })
    expect(runs.getRotationState(run.run.id)).toEqual({
      activeDateKey: '2026-08-24',
      completedWindowKey: null
    })

    runtime.close()
  })
})
