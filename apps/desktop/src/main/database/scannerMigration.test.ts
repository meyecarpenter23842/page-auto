import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyScannerMigration } from './scannerMigration'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE __page_auto_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
    CREATE TABLE accounts (id INTEGER PRIMARY KEY NOT NULL);
  `)
})

afterEach(() => db.close())

describe('Scanner source credential hardening migration', () => {
  it('creates the credential table on a fresh Scanner schema without changing the canonical foundation version', () => {
    applyScannerMigration(db)

    const migration = db.prepare('SELECT version, name FROM __page_auto_migrations WHERE version = 26').get() as {
      version: number
      name: string
    }
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scanner_token_credentials'").get() as {
      name: string
    } | undefined

    expect(migration).toEqual({ version: 26, name: 'scanner_foundation' })
    expect(table?.name).toBe('scanner_token_credentials')
  })

  it('hardens an existing v26 database idempotently', () => {
    db.prepare('INSERT INTO __page_auto_migrations(version, name, applied_at) VALUES (26, ?, 1)')
      .run('scanner_foundation')

    applyScannerMigration(db)
    applyScannerMigration(db)

    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scanner_token_credentials'").get() as {
      name: string
    } | undefined
    const migrations = db.prepare('SELECT version, name FROM __page_auto_migrations ORDER BY version').all()

    expect(table?.name).toBe('scanner_token_credentials')
    expect(migrations).toEqual([{ version: 26, name: 'scanner_foundation' }])
  })
})
