import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountRepository } from './accountRepository'
import { initializeDatabase } from './index'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createRuntime() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-db-'))
  tempDirectories.push(directory)
  const databaseFile = join(directory, 'page-auto.sqlite')
  return { directory, databaseFile, runtime: initializeDatabase(databaseFile) }
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

    expect(existsSync(databaseFile)).toBe(true)
    expect(migrations).toEqual([
      { version: 1, name: 'bootstrap_app_settings' },
      { version: 2, name: 'account_manager' },
      { version: 3, name: 'page_tab_config' },
      { version: 4, name: 'run_queue' },
      { version: 5, name: 'recovery_execution_logs' },
      { version: 6, name: 'page_tab_post_library' },
      { version: 7, name: 'page_tab_account_order_mode' }
    ])
    expect(schemaVersion?.value).toBe('7')
    expect(executionLogsTable?.name).toBe('execution_logs')
    expect(postLibraryTable?.name).toBe('page_tab_posts')
    expect(pageTabColumns.some((column) => column.name === 'account_order_mode')).toBe(true)

    runtime.close()
  })

  it('is idempotent when the same database is initialized twice', () => {
    const { databaseFile, runtime } = createRuntime()
    runtime.close()

    const reopened = initializeDatabase(databaseFile)
    const count = reopened.client
      .prepare('SELECT COUNT(*) AS count FROM __page_auto_migrations')
      .get() as { count: number }

    expect(count.count).toBe(7)
    reopened.close()
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
      cookie: 'secret-cookie'
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
