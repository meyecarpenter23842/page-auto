import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountRepository } from '../database/accountRepository'
import { initializeDatabase } from '../database'
import { PageTabRepository } from '../database/pageTabRepository'
import { RunRepository } from '../database/runRepository'
import { ConfigBackupService } from './configBackupService'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createRuntime(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  tempDirectories.push(directory)
  return initializeDatabase(join(directory, 'page-auto.sqlite'))
}

function configureSource() {
  const runtime = createRuntime('page-auto-backup-source-')
  const accounts = new AccountRepository(runtime.client)
  const tabs = new PageTabRepository(runtime.client)
  const account = accounts.create({
    uid: '10001',
    name: 'Backup account',
    category: 'Primary',
    password: 'secret-password',
    cookie: 'secret-cookie',
    twoFactorSecret: 'secret-2fa',
    emailPassword: 'secret-email-password',
    proxyPassword: 'secret-proxy-password'
  })
  const tab = tabs.create({ name: 'Page Backup', pageUid: '90001' })
  tabs.update(tab.id, {
    name: tab.name,
    pageUid: tab.pageUid,
    rotation: {
      postsPerAccount: 2,
      postDelayMinSeconds: 10,
      postDelayMaxSeconds: 20,
      accountDelayMinSeconds: 30,
      accountDelayMaxSeconds: 40
    },
    accounts: [{ accountId: account.id, enabled: true, sortOrder: 0, postsPerTurn: 2 }],
    schedules: [{ dayOfWeek: 1, startMinute: 480, endMinute: 720, enabled: true, sortOrder: 0 }],
    groupUids: ['group-1', 'group-2'],
    contentMode: 'round_robin',
    contents: ['content A', 'content B'],
    image: { folderPath: 'D:\\images', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
  })
  accounts.saveImportPreset({ name: 'UID note', delimiter: '|', mapping: ['uid', 'note'] })
  accounts.saveColumnLayout('accounts', { order: ['uid', 'name'], hidden: ['password'], widths: { uid: 180 } })
  return { runtime, account, tab }
}

describe('ConfigBackupService', () => {
  it('exports config without credentials and restores Page Tabs by account UID', () => {
    const source = configureSource()
    const sourceService = new ConfigBackupService(source.runtime.client)
    const payload = sourceService.createPayload('1.0.0')
    const raw = JSON.stringify(payload)

    expect(payload.security.containsSecrets).toBe(false)
    expect(payload.pageTabs).toHaveLength(1)
    expect(raw).not.toContain('secret-password')
    expect(raw).not.toContain('secret-cookie')
    expect(raw).not.toContain('secret-2fa')
    expect(raw).not.toContain('secret-email-password')
    expect(raw).not.toContain('secret-proxy-password')

    const targetRuntime = createRuntime('page-auto-backup-target-')
    const targetService = new ConfigBackupService(targetRuntime.client)
    const result = targetService.restoreFromJson(raw, 'backup.json')
    const targetAccounts = new AccountRepository(targetRuntime.client)
    const targetTabs = new PageTabRepository(targetRuntime.client)

    expect(result).toMatchObject({ accountsCreated: 1, pageTabsCreated: 1, pageTabsUpdated: 0 })
    const restoredAccount = targetAccounts.getByUid('10001')
    expect(restoredAccount).toMatchObject({ name: 'Backup account', category: 'Primary', status: 'unknown' })
    expect(restoredAccount?.password).toBeNull()
    expect(restoredAccount?.cookie).toBeNull()

    const restoredTab = targetTabs.list()[0]
    if (!restoredTab) throw new Error('Expected restored Page Tab.')
    expect(targetTabs.get(restoredTab.id)).toMatchObject({
      name: 'Page Backup',
      pageUid: '90001',
      groupUids: ['group-1', 'group-2'],
      contents: ['content A', 'content B']
    })
    expect(targetAccounts.listImportPresets().map((preset) => preset.name)).toContain('UID note')
    expect(targetAccounts.getColumnLayout('accounts')?.hidden).toContain('password')

    targetRuntime.close()
    source.runtime.close()
  })

  it('updates a matching Page Tab instead of duplicating it on repeated restore', () => {
    const source = configureSource()
    const raw = JSON.stringify(new ConfigBackupService(source.runtime.client).createPayload('1.0.0'))
    const targetRuntime = createRuntime('page-auto-backup-idempotent-')
    const service = new ConfigBackupService(targetRuntime.client)

    expect(service.restoreFromJson(raw).pageTabsCreated).toBe(1)
    const second = service.restoreFromJson(raw)
    expect(second.pageTabsCreated).toBe(0)
    expect(second.pageTabsUpdated).toBe(1)
    expect(new PageTabRepository(targetRuntime.client).list()).toHaveLength(1)

    targetRuntime.close()
    source.runtime.close()
  })

  it('blocks restore while an active run exists', () => {
    const source = configureSource()
    const service = new ConfigBackupService(source.runtime.client)
    const raw = JSON.stringify(service.createPayload('1.0.0'))
    const runs = new RunRepository(source.runtime.client)
    runs.createForPageTab(source.tab.id)

    expect(() => service.restoreFromJson(raw)).toThrow('chưa kết thúc')
    source.runtime.close()
  })
})
