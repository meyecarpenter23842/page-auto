import type Database from 'better-sqlite3'
import type { Dirent } from 'node:fs'
import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { LoggingSettings } from '../../shared/appSettings'
import type { LogCleanupResult } from '../../shared/loggingMaintenance'

const DAY_MS = 24 * 60 * 60 * 1000

async function cleanupEvidenceDirectory(directory: string, cutoffTimestamp: number): Promise<number> {
  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return 0
  }

  let deleted = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const filePath = join(directory, entry.name)
    try {
      const info = await stat(filePath)
      if (info.mtimeMs >= cutoffTimestamp) continue
      await unlink(filePath)
      deleted += 1
    } catch {
      // Cleanup is best-effort; one locked evidence file must not block startup/runtime.
    }
  }
  return deleted
}

export class LogMaintenanceService {
  constructor(
    private readonly database: Database.Database,
    private readonly dataDirectory: string
  ) {}

  async cleanup(
    settings: LoggingSettings,
    options: { force?: boolean; now?: number } = {}
  ): Promise<LogCleanupResult> {
    if (!options.force && !settings.autoCleanup) {
      return {
        cutoffTimestamp: null,
        deletedRows: 0,
        deletedEvidenceFiles: 0,
        skipped: true,
        message: 'Tự dọn nhật ký đang tắt.'
      }
    }
    if (settings.retentionDays === null) {
      return {
        cutoffTimestamp: null,
        deletedRows: 0,
        deletedEvidenceFiles: 0,
        skipped: true,
        message: 'Đang giữ nhật ký không giới hạn; không có mốc để dọn.'
      }
    }

    const now = options.now ?? Date.now()
    const cutoffTimestamp = now - settings.retentionDays * DAY_MS
    const deletedRows = this.database
      .prepare('DELETE FROM execution_logs WHERE timestamp < ?')
      .run(cutoffTimestamp).changes

    const deletedEvidenceFiles = (
      await cleanupEvidenceDirectory(join(this.dataDirectory, 'screenshots'), cutoffTimestamp)
    ) + (
      await cleanupEvidenceDirectory(join(this.dataDirectory, 'traces'), cutoffTimestamp)
    )

    return {
      cutoffTimestamp,
      deletedRows,
      deletedEvidenceFiles,
      skipped: false,
      message: `Đã dọn ${deletedRows} log DB và ${deletedEvidenceFiles} file evidence quá ${settings.retentionDays} ngày.`
    }
  }
}
