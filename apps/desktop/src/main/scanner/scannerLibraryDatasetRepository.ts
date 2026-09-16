import type Database from 'better-sqlite3'
import type {
  CreateScanDatasetFolderInput,
  MoveScanDatasetInput,
  RenameScanDatasetFolderInput,
  RenameScanDatasetInput,
  ScanDatasetDeleteResult,
  ScanDatasetDetails,
  ScanDatasetFolder,
  ScanDatasetFolderDeleteResult,
  ScanDatasetFolderOverview
} from '../../shared/scanner'
import { ScannerRepository } from '../database/scannerRepository'

function positiveId(value: number, label = 'ID'): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} không hợp lệ.`)
  return value
}

function datasetName(value: string): string {
  const name = value.trim()
  if (!name) throw new Error('Tên Dataset là bắt buộc.')
  if (name.length > 160) throw new Error('Tên Dataset tối đa 160 ký tự.')
  return name
}

function folderName(value: string): string {
  const name = value.trim()
  if (!name) throw new Error('Tên thư mục là bắt buộc.')
  if (name.length > 120) throw new Error('Tên thư mục tối đa 120 ký tự.')
  return name
}

interface FolderRow extends Record<string, unknown> {
  id: number
  name: string
  parentId: number | null
  createdAt: number
  updatedAt: number
}

function folderFromRow(row: FolderRow, datasetIds: number[] = []): ScanDatasetFolder {
  return {
    id: Number(row.id),
    name: String(row.name),
    parentId: row.parentId === null ? null : Number(row.parentId),
    datasetIds,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt)
  }
}

export class ScannerLibraryDatasetRepository {
  private readonly scanner: ScannerRepository

  constructor(private readonly client: Database.Database) {
    this.scanner = new ScannerRepository(client)
  }

  repairLegacyGroupMemberTypes(now = Date.now()): number {
    const result = this.client.prepare(`
      UPDATE scan_datasets
      SET dataset_type = 'group_members', updated_at = ?
      WHERE dataset_type = 'user'
        AND source_job_id IN (
          SELECT id FROM scan_jobs WHERE scan_type = 'group_members'
        )
    `).run(now)
    return result.changes
  }

  rename(input: RenameScanDatasetInput, now = Date.now()): ScanDatasetDetails {
    const id = positiveId(input.datasetId, 'Dataset ID')
    const name = datasetName(input.name)
    const updated = this.client.prepare(`
      UPDATE scan_datasets SET name = ?, updated_at = ? WHERE id = ?
    `).run(name, now, id)
    if (updated.changes === 0) throw new Error(`Không tìm thấy Dataset #${id}.`)
    const dataset = this.scanner.getDataset(id)
    if (!dataset) throw new Error(`Không thể đọc lại Dataset #${id}.`)
    return dataset
  }

  delete(datasetId: number): ScanDatasetDeleteResult {
    const id = positiveId(datasetId, 'Dataset ID')
    const result = this.client.prepare('DELETE FROM scan_datasets WHERE id = ?').run(id)
    return { datasetId: id, deleted: result.changes > 0 }
  }

  listFolders(): ScanDatasetFolderOverview {
    const rows = this.client.prepare(`
      SELECT id, name, parent_id AS parentId, created_at AS createdAt, updated_at AS updatedAt
      FROM scan_dataset_folders
      ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, parent_id, name COLLATE NOCASE, id
    `).all() as FolderRow[]
    const assignments = this.client.prepare(`
      SELECT id, folder_id AS folderId
      FROM scan_datasets
      ORDER BY updated_at DESC, id DESC
    `).all() as Array<{ id: number; folderId: number | null }>
    const byFolder = new Map<number, number[]>()
    const ungroupedDatasetIds: number[] = []
    for (const assignment of assignments) {
      if (assignment.folderId === null) {
        ungroupedDatasetIds.push(Number(assignment.id))
        continue
      }
      const folderId = Number(assignment.folderId)
      const ids = byFolder.get(folderId) ?? []
      ids.push(Number(assignment.id))
      byFolder.set(folderId, ids)
    }
    return {
      folders: rows.map((row) => folderFromRow(row, byFolder.get(Number(row.id)) ?? [])),
      ungroupedDatasetIds
    }
  }

  createFolder(input: CreateScanDatasetFolderInput, now = Date.now()): ScanDatasetFolder {
    const name = folderName(input.name)
    const parentId = input.parentId === null ? null : positiveId(input.parentId, 'Thư mục cha')
    if (parentId !== null) {
      const parent = this.requireFolder(parentId)
      if (parent.parentId !== null) throw new Error('Thư mục Dataset chỉ hỗ trợ tối đa 2 cấp.')
    }
    this.assertUniqueFolderName(name, parentId)
    const inserted = this.client.prepare(`
      INSERT INTO scan_dataset_folders(name, parent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(name, parentId, now, now)
    return this.requireFolder(Number(inserted.lastInsertRowid))
  }

  renameFolder(input: RenameScanDatasetFolderInput, now = Date.now()): ScanDatasetFolder {
    const id = positiveId(input.folderId, 'Thư mục')
    const current = this.requireFolder(id)
    const name = folderName(input.name)
    this.assertUniqueFolderName(name, current.parentId, id)
    this.client.prepare(`
      UPDATE scan_dataset_folders SET name = ?, updated_at = ? WHERE id = ?
    `).run(name, now, id)
    return this.requireFolder(id)
  }

  deleteFolder(folderId: number): ScanDatasetFolderDeleteResult {
    const id = positiveId(folderId, 'Thư mục')
    const result = this.client.prepare('DELETE FROM scan_dataset_folders WHERE id = ?').run(id)
    return { folderId: id, deleted: result.changes > 0 }
  }

  moveDataset(input: MoveScanDatasetInput, now = Date.now()): ScanDatasetFolderOverview {
    const datasetId = positiveId(input.datasetId, 'Dataset ID')
    const dataset = this.client.prepare('SELECT 1 FROM scan_datasets WHERE id = ?').get(datasetId)
    if (!dataset) throw new Error(`Không tìm thấy Dataset #${datasetId}.`)
    const folderId = input.folderId === null ? null : positiveId(input.folderId, 'Thư mục')
    if (folderId !== null) this.requireFolder(folderId)
    this.client.prepare(`
      UPDATE scan_datasets SET folder_id = ?, updated_at = ? WHERE id = ?
    `).run(folderId, now, datasetId)
    return this.listFolders()
  }

  private requireFolder(id: number): ScanDatasetFolder {
    const row = this.client.prepare(`
      SELECT id, name, parent_id AS parentId, created_at AS createdAt, updated_at AS updatedAt
      FROM scan_dataset_folders WHERE id = ?
    `).get(id) as FolderRow | undefined
    if (!row) throw new Error(`Không tìm thấy thư mục #${id}.`)
    return folderFromRow(row)
  }

  private assertUniqueFolderName(name: string, parentId: number | null, exceptId?: number): void {
    const row = this.client.prepare(`
      SELECT id FROM scan_dataset_folders
      WHERE name = ? COLLATE NOCASE
        AND ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)
        AND (? IS NULL OR id <> ?)
      LIMIT 1
    `).get(name, parentId, parentId, exceptId ?? null, exceptId ?? null)
    if (row) throw new Error(`Đã có thư mục “${name}” cùng cấp.`)
  }
}
