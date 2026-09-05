import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountGroupRepository } from './accountGroupRepository'
import { AccountRepository } from './accountRepository'
import { applyHotmailMigration } from './hotmailMigration'
import { HotmailRepository } from './hotmailRepository'
import { initializeDatabase } from './index'

const tempDirectories: string[] = []
const runtimes = new Set<ReturnType<typeof initializeDatabase>>()

afterEach(() => {
  for (const runtime of runtimes) {
    try {
      runtime.close()
    } catch {
      // A test may have already closed the runtime explicitly.
    }
  }
  runtimes.clear()
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function trackRuntime(runtime: ReturnType<typeof initializeDatabase>) {
  runtimes.add(runtime)
  return runtime
}

function createRuntime() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-db-'))
  tempDirectories.push(directory)
  const databaseFile = join(directory, 'page-auto.sqlite')
  return { directory, databaseFile, runtime: trackRuntime(initializeDatabase(databaseFile)) }
}

describe('initializeDatabase', () => {
  it('creates the database and records all migrations', () => {
    const { databaseFile, runtime } = createRuntime()

    const migrations = runtime.client
      .prepare('SELECT version, name FROM __page_auto_migrations ORDER BY version')
      .all() as Array<{ version: number; name: string }>
    const schemaVersion = runtime.client
      .prepare("SELECT value FROM app_settings WHERE key = 'schema_version'")
      .get() as { value: string } | undefined
    const executionLogsTable = runtime.client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'execution_logs'")
      .get() as { name: string } | undefined
    const postLibraryTable = runtime.client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'page_tab_posts'")
      .get() as { name: string } | undefined
    const pageTabColumns = runtime.client
      .prepare('PRAGMA table_info(page_tabs)')
      .all() as Array<{ name: string }>
    const runItemColumns = runtime.client
      .prepare('PRAGMA table_info(run_items)')
      .all() as Array<{ name: string }>
    const emailStateTable = runtime.client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'account_email_state'")
      .get() as { name: string } | undefined
    const emailStateColumns = runtime.client
      .prepare('PRAGMA table_info(account_email_state)')
      .all() as Array<{ name: string }>
    const emailProfileSettingsTable = runtime.client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'email_profile_settings'")
      .get() as { name: string } | undefined
    const emailProxySettingsTable = runtime.client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'email_proxy_settings'")
      .get() as { name: string } | undefined
    const accountGroupsTable = runtime.client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'account_groups'")
      .get() as { name: string } | undefined
    const storyItemsTable = runtime.client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'story_items'")
      .get() as { name: string } | undefined

    expect(existsSync(databaseFile)).toBe(true)
    expect(migrations).toEqual([
      { version: 1, name: 'bootstrap_app_settings' },
      { version: 2, name: 'account_manager' },
      { version: 3, name: 'page_tab_config' },
      { version: 4, name: 'run_queue' },
      { version: 5, name: 'recovery_execution_logs' },
      { version: 6, name: 'page_tab_post_library' },
      { version: 7, name: 'page_tab_account_order_mode' },
      { version: 8, name: 'hotmail_auto_subsystem' },
      { version: 9, name: 'hotmail_account_oauth_binding' },
      { version: 10, name: 'page_wall_scheduled_jobs' },
      { version: 11, name: 'scenario_shell' },
      { version: 12, name: 'account_group_manager' },
      { version: 13, name: 'global_content_library' },
      { version: 14, name: 'canonical_post_library' },
      { version: 15, name: 'copy_post_history' },
      { version: 16, name: 'page_tab_group_order_mode' },
      { version: 17, name: 'story_library' },
      { version: 18, name: 'action_workspace_persistence' },
      { version: 19, name: 'page_business_explicit_bindings' },
      { version: 20, name: 'page_tab_group_post_concurrency_and_run_claim_owner' },
      { version: 21, name: 'page_wall_recurring_schedule_rules' },
      { version: 22, name: 'page_wall_finite_plans' }
    ])
    expect(schemaVersion?.value).toBe('22')
    expect(executionLogsTable?.name).toBe('execution_logs')
    expect(postLibraryTable?.name).toBe('page_tab_posts')
    expect(pageTabColumns.some((column) => column.name === 'account_order_mode')).toBe(true)
    expect(pageTabColumns.some((column) => column.name === 'group_order_mode')).toBe(true)
    expect(pageTabColumns.some((column) => column.name === 'account_concurrency')).toBe(true)
    expect(runItemColumns.some((column) => column.name === 'claimed_by_account_id')).toBe(true)
    expect(emailStateTable?.name).toBe('account_email_state')
    expect(emailStateColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'oauth_client_id',
      'oauth_updated_at',
      'last_token_check_at'
    ]))
    expect(emailProfileSettingsTable?.name).toBe('email_profile_settings')
    expect(emailProxySettingsTable?.name).toBe('email_proxy_settings')
    expect(accountGroupsTable?.name).toBe('account_groups')
    expect(storyItemsTable?.name).toBe('story_items')

    runtime.close()
  })

  it('is idempotent when the same database is initialized twice', () => {
    const { databaseFile, runtime } = createRuntime()
    runtime.close()

    const reopened = trackRuntime(initializeDatabase(databaseFile))
    const count = reopened.client
      .prepare('SELECT COUNT(*) AS count FROM __page_auto_migrations')
      .get() as { count: number }

    expect(count.count).toBe(22)
    reopened.close()
  })

  it('upgrades v8 OAuth rows by binding the legacy default Client ID to the existing refresh token', () => {
    const client = new Database(':memory:')
    client.pragma('foreign_keys = ON')
    client.exec(`
      CREATE TABLE __page_auto_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY NOT NULL,
        uid TEXT NOT NULL UNIQUE
      );
      CREATE TABLE account_email_state (
        account_id INTEGER PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        provider TEXT NOT NULL DEFAULT 'microsoft',
        oauth_status TEXT NOT NULL DEFAULT 'missing',
        refresh_token_ciphertext TEXT,
        mail_status TEXT NOT NULL DEFAULT 'unknown',
        last_check_at INTEGER,
        last_code TEXT,
        last_code_at INTEGER,
        last_error TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE email_profile_settings (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
        external_root TEXT NOT NULL DEFAULT '',
        browser_executable TEXT NOT NULL DEFAULT '',
        oauth_client_id TEXT NOT NULL DEFAULT '',
        oauth_tenant TEXT NOT NULL DEFAULT 'consumers',
        updated_at INTEGER NOT NULL
      );
    `)
    client.prepare('INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (8, ?, ?)')
      .run('hotmail_auto_subsystem', 100)
    client.prepare('INSERT INTO accounts (id, uid) VALUES (1, ?)')
      .run('legacy-uid')
    client.prepare(`
      INSERT INTO email_profile_settings (
        id, external_root, browser_executable, oauth_client_id, oauth_tenant, updated_at
      ) VALUES (1, '', '', ?, 'consumers', 100)
    `).run('fixture-client-id')
    client.prepare(`
      INSERT INTO account_email_state (
        account_id, provider, oauth_status, refresh_token_ciphertext, mail_status, updated_at
      ) VALUES (1, 'microsoft', 'valid', ?, 'ready', 123456)
    `).run('fixture-refresh-value')

    applyHotmailMigration(client)
    applyHotmailMigration(client)

    const state = client.prepare(`
      SELECT
        oauth_client_id AS oauthClientId,
        oauth_updated_at AS oauthUpdatedAt,
        last_token_check_at AS lastTokenCheckAt,
        refresh_token_ciphertext AS refreshTokenCiphertext
      FROM account_email_state
      WHERE account_id = 1
    `).get() as {
      oauthClientId: string | null
      oauthUpdatedAt: number | null
      lastTokenCheckAt: number | null
      refreshTokenCiphertext: string | null
    }
    const migrations = client.prepare(
      'SELECT version, name FROM __page_auto_migrations ORDER BY version'
    ).all() as Array<{ version: number; name: string }>

    expect(state).toEqual({
      oauthClientId: 'fixture-client-id',
      oauthUpdatedAt: 123456,
      lastTokenCheckAt: null,
      refreshTokenCiphertext: 'fixture-refresh-value'
    })
    expect(migrations).toEqual([
      { version: 8, name: 'hotmail_auto_subsystem' },
      { version: 9, name: 'hotmail_account_oauth_binding' }
    ])

    client.close()
  })
})

describe('AccountRepository', () => {
  it('creates, updates, filters and deletes accounts', () => {
    const { runtime } = createRuntime()
    const repository = new AccountRepository(runtime.client)

    const created = repository.create({
      uid: '10001',
      name: 'Account One',
      category: 'Warm',
      cookie: 'fixture-cookie'
    })

    expect(created.uid).toBe('10001')
    expect(repository.list({ search: 'Account One' })).toHaveLength(1)

    const updated = repository.update(created.id, { status: 'valid', note: 'ready' })
    expect(updated.status).toBe('valid')
    expect(repository.list({ status: 'valid' })).toHaveLength(1)

    expect(repository.delete([created.id])).toBe(1)
    expect(repository.list()).toEqual([])
    runtime.close()
  })

  it('imports with skip/update duplicate policies and persists presets/layout', () => {
    const { runtime } = createRuntime()
    const repository = new AccountRepository(runtime.client)

    repository.create({ uid: '10001', note: 'old' })
    const skipped = repository.import({
      rawText: '10001|new\n10002|fresh',
      delimiter: '|',
      mapping: ['uid', 'note'],
      duplicatePolicy: 'skip'
    })
    expect(skipped).toMatchObject({ imported: 1, updated: 0, skipped: 1 })

    const updated = repository.import({
      rawText: '10001|new',
      delimiter: '|',
      mapping: ['uid', 'note'],
      duplicatePolicy: 'update'
    })
    expect(updated).toMatchObject({ imported: 0, updated: 1, skipped: 0 })
    expect(repository.getByUid('10001')?.note).toBe('new')

    const preset = repository.saveImportPreset({ name: 'My preset', delimiter: '|', mapping: ['uid', 'cookie'] })
    expect(repository.listImportPresets()).toEqual([preset])

    const layout = { order: ['uid', 'name'], hidden: ['password'], widths: { uid: 180 } }
    repository.saveColumnLayout('accounts', layout)
    expect(repository.getColumnLayout('accounts')).toEqual(layout)

    runtime.close()
  })
})

describe('AccountGroupRepository', () => {
  it('creates, assigns, renames, removes and filters one group per account', () => {
    const { runtime } = createRuntime()
    const accounts = new AccountRepository(runtime.client)
    const groups = new AccountGroupRepository(runtime.client)
    const first = accounts.create({ uid: 'group-1', category: 'Legacy Warm' })
    const second = accounts.create({ uid: 'group-2' })

    const migratedOverview = groups.overview()
    expect(migratedOverview.groups).toEqual([
      expect.objectContaining({ name: 'Legacy Warm', accountCount: 1 })
    ])
    expect(migratedOverview.totalAccounts).toBe(2)
    expect(migratedOverview.ungroupedCount).toBe(1)

    const cold = groups.create({ name: 'Cold' })
    expect(groups.assign({ accountIds: [first.id, second.id, second.id], groupId: cold.id })).toBe(2)
    expect(accounts.list({ category: 'Cold' })).toHaveLength(2)

    const renamed = groups.rename({ id: cold.id, name: 'Ready' })
    expect(renamed.name).toBe('Ready')
    expect(renamed.accountCount).toBe(2)
    expect(accounts.list({ category: 'Ready' })).toHaveLength(2)

    expect(groups.assign({ accountIds: [second.id], groupId: null })).toBe(1)
    expect(groups.overview()).toMatchObject({ totalAccounts: 2, ungroupedCount: 1 })

    expect(groups.delete(cold.id)).toBe(true)
    expect(accounts.getById(first.id)?.category).toBeNull()
    expect(groups.overview().groups.map((group) => group.name)).toEqual(['Legacy Warm'])

    runtime.close()
  })
})

describe('HotmailRepository account binding and security boundary', () => {
  it('reads Email credentials live from Account Manager instead of duplicating account credential state', () => {
    const { runtime } = createRuntime()
    const accounts = new AccountRepository(runtime.client)
    const hotmail = new HotmailRepository(runtime.client)
    const account = accounts.create({
      uid: '20001',
      email: 'first@outlook.com',
      emailPassword: 'fixture-pass-a',
      backupEmail: 'first-backup@example.com'
    })

    expect(hotmail.listDashboardRows()[0]).toMatchObject({
      accountId: account.id,
      uid: '20001',
      email: 'first@outlook.com',
      backupEmail: 'first-backup@example.com'
    })

    accounts.update(account.id, {
      email: 'second@outlook.com',
      emailPassword: 'fixture-pass-b',
      backupEmail: null
    })

    const rebound = hotmail.listDashboardRows()[0]
    expect(rebound).toMatchObject({
      accountId: account.id,
      uid: '20001',
      email: 'second@outlook.com',
      backupEmail: null
    })
    expect(rebound?.emailPasswordMasked).toMatch(/^•+$/)
    expect(JSON.stringify(rebound)).not.toContain('fixture-pass-a')
    expect(JSON.stringify(rebound)).not.toContain('fixture-pass-b')

    runtime.close()
  })

  it('keeps Client ID + encrypted Refresh Token canonical per account without exposing token/proxy credentials', () => {
    const { runtime } = createRuntime()
    const accounts = new AccountRepository(runtime.client)
    const hotmail = new HotmailRepository(runtime.client)
    const account = accounts.create({
      uid: '20002',
      email: 'demo@outlook.com',
      emailPassword: 'fixture-mail-pass',
      backupEmail: 'backup@example.com'
    })

    hotmail.updateEmailState(account.id, {
      oauthStatus: 'valid',
      oauthClientId: 'fixture-canonical-client',
      refreshTokenCiphertext: 'fixture-refresh-token',
      oauthUpdatedAt: 111,
      lastTokenCheckAt: 222,
      mailStatus: 'ready'
    })
    hotmail.saveSettings({
      profileRoot: 'D:\\MaxHotmail',
      browserExecutable: '',
      oauthClientId: 'fixture-default-client',
      oauthTenant: 'consumers',
      proxyMode: 'random_ipv4',
      proxyListText: '203.0.113.10:8080:user:pass'
    }, ['203.0.113.10:8080:user:pass'])

    const dashboard = hotmail.listDashboardRows()[0]
    const dashboardJson = JSON.stringify(hotmail.listDashboardRows())
    const settingsJson = JSON.stringify(hotmail.getSettingsView())
    const state = hotmail.getEmailState(account.id)

    expect(dashboard).toMatchObject({
      accountId: account.id,
      oauthClientId: 'fixture-canonical-client',
      hasRefreshToken: true,
      oauthUpdatedAt: 111,
      lastTokenCheckAt: 222
    })
    expect(state).toMatchObject({
      accountId: account.id,
      oauthClientId: 'fixture-canonical-client',
      refreshTokenCiphertext: 'fixture-refresh-token'
    })
    expect(dashboardJson).not.toContain('fixture-mail-pass')
    expect(dashboardJson).not.toContain('fixture-refresh-token')
    expect(settingsJson).not.toContain('user')
    expect(settingsJson).not.toContain('pass')
    expect(dashboard?.emailPasswordMasked).toMatch(/^•+$/)
    expect(hotmail.getSettingsView().proxyPreview).toEqual(['http://203.0.113.10:8080'])

    runtime.close()
  })
})