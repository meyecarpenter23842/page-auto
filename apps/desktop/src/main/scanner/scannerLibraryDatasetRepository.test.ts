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

  it('supports exactly two folder levels and never deletes Dataset data with a folder', () => {
    const scanner = new ScannerRepository(db)
    const job = scanner.createJob({
      scanType: 'group', source: { type: 'account', accountId: 1 }, query: 'mỹ phẩm', filters: {}, limit: 10
    }, 200)
    scanner.addResult(job.id, {
      entityId: 'group-1', displayName: 'Mỹ phẩm miền Tây', url: null, status: 'success', data: {}, scannedAt: 210
    }, 210)
    const dataset = scanner.createDatasetFromJob({ jobId: job.id, name: 'Dataset mỹ phẩm' }, 220)

    const library = new ScannerLibraryDatasetRepository(db)
    const root = library.createFolder({ name: 'Mỹ phẩm', parentId: null }, 230)
    const child = library.createFolder({ name: 'Miền Tây', parentId: root.id }, 240)

    expect(() => library.createFolder({ name: 'Cấp 3', parentId: child.id }, 250))
      .toThrow('tối đa 2 cấp')
    expect(() => library.createFolder({ name: 'mỹ phẩm', parentId: null }, 250))
      .toThrow('cùng cấp')

    const moved = library.moveDataset({ datasetId: dataset.id, folderId: child.id }, 260)
    expect(moved.folders.find((folder) => folder.id === child.id)?.datasetIds).toEqual([dataset.id])
    expect(moved.ungroupedDatasetIds).not.toContain(dataset.id)

    const renamed = library.renameFolder({ folderId: child.id, name: 'Miền Nam' }, 270)
    expect(renamed.name).toBe('Miền Nam')

    expect(library.deleteFolder(root.id)).toEqual({ folderId: root.id, deleted: true })
    const afterDelete = library.listFolders()
    expect(afterDelete.folders).toEqual([])
    expect(afterDelete.ungroupedDatasetIds).toContain(dataset.id)
    expect(scanner.getDataset(dataset.id)?.name).toBe('Dataset mỹ phẩm')
  })
})
