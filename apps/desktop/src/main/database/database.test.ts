import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from './index'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('initializeDatabase', () => {
  it('creates the database and records the bootstrap migration', () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-auto-db-'))
    tempDirectories.push(directory)
    const databaseFile = join(directory, 'page-auto.sqlite')

    const runtime = initializeDatabase(databaseFile)

    const migration = runtime.client
      .prepare('SELECT version, name FROM __page_auto_migrations WHERE version = 1')
      .get() as { version: number; name: string } | undefined
    const schemaVersion = runtime.client
      .prepare("SELECT value FROM app_settings WHERE key = 'schema_version'")
      .get() as { value: string } | undefined

    expect(existsSync(databaseFile)).toBe(true)
    expect(migration).toEqual({ version: 1, name: 'bootstrap_app_settings' })
    expect(schemaVersion?.value).toBe('1')

    runtime.close()
  })

  it('is idempotent when the same database is initialized twice', () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-auto-db-'))
    tempDirectories.push(directory)
    const databaseFile = join(directory, 'page-auto.sqlite')

    initializeDatabase(databaseFile).close()
    const runtime = initializeDatabase(databaseFile)
    const count = runtime.client
      .prepare('SELECT COUNT(*) AS count FROM __page_auto_migrations')
      .get() as { count: number }

    expect(count.count).toBe(1)
    runtime.close()
  })
})
