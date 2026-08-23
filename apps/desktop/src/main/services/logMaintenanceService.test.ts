import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../shared/appSettings'
import { initializeDatabase } from '../database'
import { LogMaintenanceService } from './logMaintenanceService'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-log-maintenance-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  const service = new LogMaintenanceService(runtime.client, directory)
  return { directory, runtime, service }
}

function insertLog(runtime: ReturnType<typeof initializeDatabase>, timestamp: number): void {
  runtime.client.prepare(`
    INSERT INTO execution_logs (
      timestamp, run_id, run_item_id, page_tab_id, account_id, page_uid, group_uid,
      content_index, image_paths_json, action, result, error_code, error_message,
      screenshot_path, published_url, attempt_count, retry_disposition
    ) VALUES (?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'test', 'failed', NULL, NULL, NULL, NULL, 0, 'blocked')
  `).run(timestamp)
}

describe('LogMaintenanceService', () => {
  it('cleans expired DB logs and evidence files but keeps recent files', async () => {
    const { directory, runtime, service } = fixture()
    const now = Date.UTC(2026, 7, 23, 12, 0, 0)
    const old = now - 10 * 24 * 60 * 60 * 1000
    const recent = now - 2 * 24 * 60 * 60 * 1000
    insertLog(runtime, old)
    insertLog(runtime, recent)

    for (const folder of ['screenshots', 'traces']) mkdirSync(join(directory, folder), { recursive: true })
    const oldShot = join(directory, 'screenshots', 'old.png')
    const recentShot = join(directory, 'screenshots', 'recent.png')
    const oldTrace = join(directory, 'traces', 'old.zip')
    writeFileSync(oldShot, 'old')
    writeFileSync(recentShot, 'recent')
    writeFileSync(oldTrace, 'old')
    utimesSync(oldShot, new Date(old), new Date(old))
    utimesSync(oldTrace, new Date(old), new Date(old))
    utimesSync(recentShot, new Date(recent), new Date(recent))

    const result = await service.cleanup({ ...DEFAULT_APP_SETTINGS.logging, retentionDays: 7, autoCleanup: true }, { now })
    expect(result).toMatchObject({ deletedRows: 1, deletedEvidenceFiles: 2, skipped: false })
    const count = runtime.client.prepare('SELECT COUNT(*) AS count FROM execution_logs').get() as { count: number }
    expect(count.count).toBe(1)
    runtime.close()
  })

  it('skips automatic cleanup when disabled but force cleanup still works', async () => {
    const { runtime, service } = fixture()
    const settings = { ...DEFAULT_APP_SETTINGS.logging, retentionDays: 7 as const, autoCleanup: false }
    expect((await service.cleanup(settings)).skipped).toBe(true)
    expect((await service.cleanup(settings, { force: true })).skipped).toBe(false)
    runtime.close()
  })
})
