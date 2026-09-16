import type Database from 'better-sqlite3'
import type { RenameScanDatasetInput, ScanDatasetDeleteResult, ScanDatasetDetails } from '../../shared/scanner'
import { ScannerRepository } from '../database/scannerRepository'

function positiveId(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error('Dataset ID không hợp lệ.')
  return value
}

function datasetName(value: string): string {
  const name = value.trim()
  if (!name) throw new Error('Tên Dataset là bắt buộc.')
  if (name.length > 160) throw new Error('Tên Dataset tối đa 160 ký tự.')
  return name
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
    const id = positiveId(input.datasetId)
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
    const id = positiveId(datasetId)
    const result = this.client.prepare('DELETE FROM scan_datasets WHERE id = ?').run(id)
    return { datasetId: id, deleted: result.changes > 0 }
  }
}
