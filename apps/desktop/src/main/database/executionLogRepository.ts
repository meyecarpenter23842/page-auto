import type Database from 'better-sqlite3'
import type {
  CreateExecutionLogInput,
  ExecutionLogFilters,
  ExecutionLogRecord,
  RetryDisposition
} from '../../shared/executionLogs'

interface ExecutionLogRow {
  id: number
  timestamp: number
  runId: number | null
  runItemId: number | null
  pageTabId: number | null
  accountId: number | null
  pageUid: string | null
  groupUid: string | null
  contentIndex: number | null
  imagePathsJson: string | null
  action: string
  result: string
  errorCode: string | null
  errorMessage: string | null
  screenshotPath: string | null
  publishedUrl: string | null
  attemptCount: number
  retryDisposition: string
}

function parseImagePaths(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function rowToRecord(row: ExecutionLogRow): ExecutionLogRecord {
  return {
    id: row.id,
    timestamp: row.timestamp,
    runId: row.runId,
    runItemId: row.runItemId,
    pageTabId: row.pageTabId,
    accountId: row.accountId,
    pageUid: row.pageUid,
    groupUid: row.groupUid,
    contentIndex: row.contentIndex,
    imagePaths: parseImagePaths(row.imagePathsJson),
    action: row.action,
    result: row.result,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    screenshotPath: row.screenshotPath,
    publishedUrl: row.publishedUrl,
    attemptCount: row.attemptCount,
    retryDisposition: row.retryDisposition as RetryDisposition
  }
}

export class ExecutionLogRepository {
  constructor(private readonly client: Database.Database) {}

  insert(input: CreateExecutionLogInput): ExecutionLogRecord {
    const timestamp = input.timestamp ?? Date.now()
    const result = this.client.prepare(`
      INSERT INTO execution_logs (
        timestamp, run_id, run_item_id, page_tab_id, account_id, page_uid, group_uid,
        content_index, image_paths_json, action, result, error_code, error_message,
        screenshot_path, published_url, attempt_count, retry_disposition
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      timestamp,
      input.runId,
      input.runItemId,
      input.pageTabId,
      input.accountId,
      input.pageUid,
      input.groupUid,
      input.contentIndex,
      input.imagePaths?.length ? JSON.stringify(input.imagePaths) : null,
      input.action,
      input.result,
      input.errorCode,
      input.errorMessage,
      input.screenshotPath,
      input.publishedUrl,
      input.attemptCount,
      input.retryDisposition
    )
    const created = this.get(Number(result.lastInsertRowid))
    if (!created) throw new Error('Không thể đọc lại execution log vừa tạo.')
    return created
  }

  get(id: number): ExecutionLogRecord | null {
    const row = this.client.prepare(`
      SELECT
        id, timestamp, run_id AS runId, run_item_id AS runItemId,
        page_tab_id AS pageTabId, account_id AS accountId, page_uid AS pageUid,
        group_uid AS groupUid, content_index AS contentIndex, image_paths_json AS imagePathsJson,
        action, result, error_code AS errorCode, error_message AS errorMessage,
        screenshot_path AS screenshotPath, published_url AS publishedUrl,
        attempt_count AS attemptCount, retry_disposition AS retryDisposition
      FROM execution_logs
      WHERE id = ?
    `).get(id) as ExecutionLogRow | undefined
    return row ? rowToRecord(row) : null
  }

  getLatestForRunItem(runItemId: number): ExecutionLogRecord | null {
    const row = this.client.prepare(`
      SELECT
        id, timestamp, run_id AS runId, run_item_id AS runItemId,
        page_tab_id AS pageTabId, account_id AS accountId, page_uid AS pageUid,
        group_uid AS groupUid, content_index AS contentIndex, image_paths_json AS imagePathsJson,
        action, result, error_code AS errorCode, error_message AS errorMessage,
        screenshot_path AS screenshotPath, published_url AS publishedUrl,
        attempt_count AS attemptCount, retry_disposition AS retryDisposition
      FROM execution_logs
      WHERE run_item_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(runItemId) as ExecutionLogRow | undefined
    return row ? rowToRecord(row) : null
  }

  list(filters: ExecutionLogFilters = {}): ExecutionLogRecord[] {
    const conditions: string[] = []
    const params: Array<string | number> = []

    if (filters.pageTabId !== undefined) {
      conditions.push('page_tab_id = ?')
      params.push(filters.pageTabId)
    }
    if (filters.accountId !== undefined) {
      conditions.push('account_id = ?')
      params.push(filters.accountId)
    }
    const groupUid = filters.groupUid?.trim()
    if (groupUid) {
      conditions.push('group_uid LIKE ?')
      params.push(`%${groupUid}%`)
    }
    const result = filters.result?.trim()
    if (result && result !== 'all') {
      conditions.push('result = ?')
      params.push(result)
    }
    if (filters.fromTimestamp !== undefined) {
      conditions.push('timestamp >= ?')
      params.push(filters.fromTimestamp)
    }
    if (filters.toTimestamp !== undefined) {
      conditions.push('timestamp <= ?')
      params.push(filters.toTimestamp)
    }

    const limit = Math.max(1, Math.min(1000, Math.floor(filters.limit ?? 250)))
    params.push(limit)
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = this.client.prepare(`
      SELECT
        id, timestamp, run_id AS runId, run_item_id AS runItemId,
        page_tab_id AS pageTabId, account_id AS accountId, page_uid AS pageUid,
        group_uid AS groupUid, content_index AS contentIndex, image_paths_json AS imagePathsJson,
        action, result, error_code AS errorCode, error_message AS errorMessage,
        screenshot_path AS screenshotPath, published_url AS publishedUrl,
        attempt_count AS attemptCount, retry_disposition AS retryDisposition
      FROM execution_logs
      ${where}
      ORDER BY id DESC
      LIMIT ?
    `).all(...params) as ExecutionLogRow[]
    return rows.map(rowToRecord)
  }
}
