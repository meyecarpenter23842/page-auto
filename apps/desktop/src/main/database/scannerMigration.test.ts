import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyScannerMigration } from './scannerMigration'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
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

describe('Scanner source credential and Dataset folder hardening', () => {
  it('creates hardened Scanner tables on a fresh schema without changing the canonical foundation version', () => {
    applyScannerMigration(db)

    const migration = db.prepare('SELECT version, name FROM __page_auto_migrations WHERE version = 26').get() as {
      version: number
      name: string
    }
    const credentialTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scanner_token_credentials'").get() as {
      name: string
    } | undefined
    const folderTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scan_dataset_folders'").get() as {
      name: string
    } | undefined
    const datasetColumns = db.prepare('PRAGMA table_info(scan_datasets)').all() as Array<{ name: string }>

    expect(migration).toEqual({ version: 26, name: 'scanner_foundation' })
    expect(credentialTable?.name).toBe('scanner_token_credentials')
    expect(folderTable?.name).toBe('scan_dataset_folders')
    expect(datasetColumns.some((column) => column.name === 'folder_id')).toBe(true)
  })

  it('hardens an existing v26 database idempotently and keeps migration history stable', () => {
    db.exec(`
      CREATE TABLE scan_datasets (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        dataset_type TEXT NOT NULL,
        name TEXT NOT NULL,
        source_job_id INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    db.prepare('INSERT INTO __page_auto_migrations(version, name, applied_at) VALUES (26, ?, 1)')
      .run('scanner_foundation')

    applyScannerMigration(db)
    applyScannerMigration(db)

    const credentialTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scanner_token_credentials'").get() as {
      name: string
    } | undefined
    const folderTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scan_dataset_folders'").get() as {
      name: string
    } | undefined
    const datasetColumns = db.prepare('PRAGMA table_info(scan_datasets)').all() as Array<{ name: string }>
    const migrations = db.prepare('SELECT version, name FROM __page_auto_migrations ORDER BY version').all()

    expect(credentialTable?.name).toBe('scanner_token_credentials')
    expect(folderTable?.name).toBe('scan_dataset_folders')
    expect(datasetColumns.filter((column) => column.name === 'folder_id')).toHaveLength(1)
    expect(migrations).toEqual([{ version: 26, name: 'scanner_foundation' }])
  })
})
