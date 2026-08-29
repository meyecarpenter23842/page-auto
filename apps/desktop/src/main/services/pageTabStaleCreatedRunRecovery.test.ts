import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountRepository } from '../database/accountRepository'
import { initializeDatabase } from '../database/index'
import { PageTabRepository } from '../database/pageTabRepository'
import { RunRepository } from '../database/runRepository'
import { RotationService } from './rotationService'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function tabConfig(accountId: number, enabled: boolean) {
  return {
    name: 'Page A',
    pageUid: '90001',
    rotation: {
      postsPerAccount: 1,
      postDelayMinSeconds: 0,
      postDelayMaxSeconds: 0,
      accountDelayMinSeconds: 0,
      accountDelayMaxSeconds: 0
    },
    accounts: [{ accountId, enabled, sortOrder: 0, postsPerTurn: null }],
    schedules: [{ dayOfWeek: 2, startMinute: 480, endMinute: 720, enabled: true, sortOrder: 0 }],
    groupUids: ['group-1'],
    contentMode: 'sequential' as const,
    contents: ['hello'],
    image: { folderPath: '', mode: 'sequential' as const, imagesPerPost: 1, missingPolicy: 'text_only' as const }
  }
}

describe('Page Tab stale created run recovery', () => {
  it('blocks a new zero-account snapshot and rebuilds a legacy stale created run after accounts are enabled', () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-auto-stale-run-'))
    tempDirectories.push(directory)
    const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
    const accounts = new AccountRepository(runtime.client)
    const tabs = new PageTabRepository(runtime.client)
    const runs = new RunRepository(runtime.client)

    const account = accounts.create({ uid: '10001', name: 'Runner' })
    const tab = tabs.create({ name: 'Page A', pageUid: '90001' })
    tabs.update(tab.id, tabConfig(account.id, false))

    expect(() => runs.createForPageTab(tab.id)).toThrow('Page Tab không có tài khoản được bật để chạy.')
    expect(runs.getLatestForPageTab(tab.id)).toBeNull()

    const staleSnapshot = {
      version: 1 as const,
      pageTabId: tab.id,
      tabName: 'Page A',
      pageUid: '90001',
      rotation: {
        postsPerAccount: 1,
        postDelayMinSeconds: 0,
        postDelayMaxSeconds: 0,
        accountDelayMinSeconds: 0,
        accountDelayMaxSeconds: 0,
        accountOrderMode: 'sequential' as const
      },
      accounts: [{ accountId: account.id, enabled: false, sortOrder: 0, postsPerTurn: null }],
      schedules: [{ dayOfWeek: 2, startMinute: 480, endMinute: 720, enabled: true, sortOrder: 0 }],
      contentMode: 'sequential' as const,
      contents: ['hello'],
      image: { folderPath: '', mode: 'sequential' as const, imagesPerPost: 1, missingPolicy: 'text_only' as const },
      groupSourceCount: 1
    }
    const now = Date.now()
    const staleResult = runtime.client.prepare(`
      INSERT INTO runs (
        page_tab_id, status, tab_name, page_uid, snapshot_json,
        created_at, started_at, paused_at, completed_at, updated_at
      ) VALUES (?, 'created', ?, ?, ?, ?, NULL, NULL, NULL, ?)
    `).run(tab.id, 'Page A', '90001', JSON.stringify(staleSnapshot), now, now)
    const staleRunId = Number(staleResult.lastInsertRowid)

    tabs.update(tab.id, tabConfig(account.id, true))

    const service = new RotationService(
      runs,
      { executeSingle: async () => new Promise(() => undefined) },
      {
        now: () => new Date(2026, 7, 24, 10, 0),
        random: () => 0,
        sleep: () => new Promise<void>(() => undefined)
      }
    )

    const started = service.start({ pageTabId: tab.id })

    expect(runs.get(staleRunId)?.run.status).toBe('stopped')
    expect(started.runId).not.toBe(staleRunId)
    expect(started.run?.run.snapshot.accounts.filter((item) => item.enabled)).toHaveLength(1)
    expect(runs.getLatestForPageTab(tab.id)?.run.id).toBe(started.runId)

    service.dispose()
    runtime.close()
  })
})
