import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyScannerMigration } from '../database/scannerMigration'
import { ScannerRepository } from '../database/scannerRepository'
import { ScannerLibraryDatasetRepository } from './scannerLibraryDatasetRepository'

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
    INSERT INTO accounts(id) VALUES (1);
  `)
  applyScannerMigration(db)
})

afterEach(() => db.close())

describe('ScannerLibraryDatasetRepository', () => {
  it('repairs member type, renames and deletes the canonical Scanner Dataset', () => {
    const scanner = new ScannerRepository(db)
    const job = scanner.createJob({
      scanType: 'group_members', source: { type: 'account', accountId: 1 }, query: '123', filters: {}, limit: 10
    }, 100)
    scanner.addResult(job.id, {
      entityId: '456', displayName: 'Member 456', url: 'https://www.facebook.com/456', status: 'success',
      data: { sourceGroupId: '123' }, scannedAt: 110
    }, 110)

    const insert = db.prepare(`
      INSERT INTO scan_datasets(dataset_type, name, source_job_id, created_at, updated_at)
      VALUES ('user', 'Legacy members', ?, 120, 120)
    `).run(job.id)
    const datasetId = Number(insert.lastInsertRowid)

    const library = new ScannerLibraryDatasetRepository(db)
    expect(library.repairLegacyGroupMemberTypes(130)).toBe(1)
    expect(scanner.getDataset(datasetId)?.type).toBe('group_members')
    expect(library.rename({ datasetId, name: 'Khách hàng nhóm A' }, 140).name).toBe('Khách hàng nhóm A')
    expect(library.delete(datasetId)).toEqual({ datasetId, deleted: true })
    expect(scanner.getDataset(datasetId)).toBeNull()
  })
})
