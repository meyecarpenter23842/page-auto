import type Database from 'better-sqlite3'
import type {
  PageWallJobLogEntry,
  PageWallJobRecord,
  PageWallJobStatus
} from '../../shared/pageWallJobs'
import type { PostingJobResult, PostingSessionValidation } from '../../shared/posting'

export interface CreatePageWallJobInput {
  scheduledAt: number
  pageTabId: number
  pageTabName: string
  pageUid: string
  accountId: number
  accountUid: string
  accountName: string | null
  content: string
  imagePaths: string[]
}

interface PageWallJobRow {
  id: number
  status: string
  scheduledAt: number
  pageTabId: number
  pageTabName: string
  pageUid: string
  accountId: number
  accountUid: string
  accountName: string | null
  content: string
  imagePathsJson: string
  resultStatus: string | null
  resultCode: string | null
  resultMessage: string | null
  publishedUrl: string | null
  screenshotPath: string | null
  tracePath: string | null
  sessionValidationJson: string | null
  logsJson: string
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  updatedAt: number
}

const selectColumns = `
  id, status, scheduled_at AS scheduledAt,
  page_tab_id AS pageTabId, page_tab_name AS pageTabName, page_uid AS pageUid,
  account_id AS accountId, account_uid AS accountUid, account_name AS accountName,
  content, image_paths_json AS imagePathsJson,
  result_status AS resultStatus, result_code AS resultCode, result_message AS resultMessage,
  published_url AS publishedUrl, screenshot_path AS screenshotPath, trace_path AS tracePath,
  session_validation_json AS sessionValidationJson, logs_json AS logsJson,
  created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt, updated_at AS updatedAt
`

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function parseLogs(value: string): PageWallJobLogEntry[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is PageWallJobLogEntry => Boolean(
      item
      && typeof item === 'object'
      && typeof (item as PageWallJobLogEntry).at === 'number'
      && typeof (item as PageWallJobLogEntry).message === 'string'
    ))
  } catch {
    return []
  }
}

function parseSessionValidation(value: string | null): PostingSessionValidation | null {
  if (!value) return null
  try {
    return JSON.parse(value) as PostingSessionValidation
  } catch {
    return null
  }
}

function rowToRecord(row: PageWallJobRow): PageWallJobRecord {
  return {
    id: row.id,
    status: row.status as PageWallJobStatus,
    scheduledAt: row.scheduledAt,
    pageTabId: row.pageTabId,
    pageTabName: row.pageTabName,
    pageUid: row.pageUid,
    accountId: row.accountId,
    accountUid: row.accountUid,
    accountName: row.accountName,
    content: row.content,
    imagePaths: parseStringArray(row.imagePathsJson),
    resultStatus: row.resultStatus as PageWallJobRecord['resultStatus'],
    resultCode: row.resultCode as PageWallJobRecord['resultCode'],
    resultMessage: row.resultMessage,
    publishedUrl: row.publishedUrl,
    screenshotPath: row.screenshotPath,
    tracePath: row.tracePath,
    sessionValidation: parseSessionValidation(row.sessionValidationJson),
    logs: parseLogs(row.logsJson),
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    updatedAt: row.updatedAt
  }
}

function appendLog(logs: PageWallJobLogEntry[], at: number, message: string): PageWallJobLogEntry[] {
  return [...logs, { at, message }].slice(-50)
}

export class PageWallJobRepository {
  constructor(private readonly client: Database.Database) {}

  create(input: CreatePageWallJobInput, now = Date.now()): PageWallJobRecord {
    const result = this.client.prepare(`
      INSERT INTO page_wall_jobs (
        status, scheduled_at, page_tab_id, page_tab_name, page_uid,
        account_id, account_uid, account_name, content, image_paths_json,
        logs_json, created_at, updated_at
      ) VALUES ('pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.scheduledAt,
      input.pageTabId,
      input.pageTabName,
      input.pageUid,
      input.accountId,
      input.accountUid,
      input.accountName,
      input.content,
      JSON.stringify(input.imagePaths),
      JSON.stringify([{ at: now, message: 'Đã tạo lịch hẹn đăng.' } satisfies PageWallJobLogEntry]),
      now,
      now
    )
    const created = this.get(Number(result.lastInsertRowid))
    if (!created) throw new Error('Không thể đọc lại lịch Đăng Tường vừa tạo.')
    return created
  }

  get(id: number): PageWallJobRecord | null {
    const row = this.client.prepare(`SELECT ${selectColumns} FROM page_wall_jobs WHERE id = ?`)
      .get(id) as PageWallJobRow | undefined
    return row ? rowToRecord(row) : null
  }

  list(limit = 200): PageWallJobRecord[] {
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)))
    const rows = this.client.prepare(`
      SELECT ${selectColumns}
      FROM page_wall_jobs
      ORDER BY
        CASE WHEN status IN ('running', 'pending') THEN 0 ELSE 1 END,
        CASE WHEN status IN ('running', 'pending') THEN scheduled_at ELSE -scheduled_at END ASC,
        id DESC
      LIMIT ?
    `).all(safeLimit) as PageWallJobRow[]
    return rows.map(rowToRecord)
  }

  claimNextDue(now: number, excludedPageTabIds: number[] = []): PageWallJobRecord | null {
    const claim = this.client.transaction(() => {
      const exclusions = excludedPageTabIds.length
        ? `AND page_tab_id NOT IN (${excludedPageTabIds.map(() => '?').join(', ')})`
        : ''
      const row = this.client.prepare(`
        SELECT ${selectColumns}
        FROM page_wall_jobs
        WHERE status = 'pending' AND scheduled_at <= ? ${exclusions}
        ORDER BY scheduled_at ASC, id ASC
        LIMIT 1
      `).get(now, ...excludedPageTabIds) as PageWallJobRow | undefined
      if (!row) return null

      const current = rowToRecord(row)
      const logs = appendLog(current.logs, now, 'Đến giờ chạy; scheduler đã nhận job.')
      const updated = this.client.prepare(`
        UPDATE page_wall_jobs
        SET status = 'running', started_at = ?, updated_at = ?, logs_json = ?
        WHERE id = ? AND status = 'pending'
      `).run(now, now, JSON.stringify(logs), current.id)
      if (updated.changes !== 1) return null
      return this.get(current.id)
    })
    return claim()
  }

  finish(id: number, result: PostingJobResult, now = Date.now()): PageWallJobRecord {
    const finish = this.client.transaction(() => {
      const current = this.get(id)
      if (!current) throw new Error(`Không tìm thấy lịch Đăng Tường #${id}.`)
      if (current.status !== 'running') throw new Error(`Lịch Đăng Tường #${id} không ở trạng thái running.`)

      const finalStatus: PageWallJobStatus = result.status === 'success' ? 'success' : 'failed'
      const logMessage = finalStatus === 'success'
        ? `Hoàn tất thành công: ${result.message}`
        : `Hoàn tất thất bại${result.code ? ` (${result.code})` : ''}: ${result.message}`
      const logs = appendLog(current.logs, now, logMessage)

      this.client.prepare(`
        UPDATE page_wall_jobs
        SET
          status = ?, result_status = ?, result_code = ?, result_message = ?,
          published_url = ?, screenshot_path = ?, trace_path = ?, session_validation_json = ?,
          logs_json = ?, finished_at = ?, updated_at = ?
        WHERE id = ? AND status = 'running'
      `).run(
        finalStatus,
        result.status,
        result.code ?? null,
        result.message,
        result.publishedUrl ?? null,
        result.screenshotPath ?? null,
        result.tracePath ?? null,
        result.sessionValidation ? JSON.stringify(result.sessionValidation) : null,
        JSON.stringify(logs),
        now,
        now,
        id
      )
      const finished = this.get(id)
      if (!finished) throw new Error(`Không thể đọc lại lịch Đăng Tường #${id} sau khi hoàn tất.`)
      return finished
    })
    return finish()
  }

  cancel(id: number, now = Date.now()): PageWallJobRecord {
    const cancel = this.client.transaction(() => {
      const current = this.get(id)
      if (!current) throw new Error(`Không tìm thấy lịch Đăng Tường #${id}.`)
      if (current.status !== 'pending') throw new Error('Chỉ có thể hủy bài hẹn chưa bắt đầu chạy.')
      const logs = appendLog(current.logs, now, 'Đã hủy lịch trước khi chạy.')
      this.client.prepare(`
        UPDATE page_wall_jobs
        SET status = 'cancelled', logs_json = ?, finished_at = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(JSON.stringify(logs), now, now, id)
      const cancelled = this.get(id)
      if (!cancelled) throw new Error(`Không thể đọc lại lịch Đăng Tường #${id} sau khi hủy.`)
      return cancelled
    })
    return cancel()
  }

  recoverInterruptedRunning(now = Date.now()): number {
    const recover = this.client.transaction(() => {
      const rows = this.client.prepare(`
        SELECT ${selectColumns}
        FROM page_wall_jobs
        WHERE status = 'running'
        ORDER BY id ASC
      `).all() as PageWallJobRow[]

      for (const row of rows) {
        const current = rowToRecord(row)
        const message = 'Ứng dụng bị đóng hoặc gián đoạn khi job đang chạy. Không tự retry để tránh đăng trùng; cần kiểm tra Tường Page trước khi tạo lịch mới.'
        const logs = appendLog(current.logs, now, message)
        this.client.prepare(`
          UPDATE page_wall_jobs
          SET status = 'failed', result_status = 'failed', result_code = 'unexpected_error',
              result_message = ?, logs_json = ?, finished_at = ?, updated_at = ?
          WHERE id = ? AND status = 'running'
        `).run(message, JSON.stringify(logs), now, now, current.id)
      }
      return rows.length
    })
    return recover()
  }
}
