import type Database from 'better-sqlite3'
import {
  SCAN_JOB_STATUSES,
  SCAN_RESULT_STATUSES,
  SCAN_TYPES,
  datasetTypeForScanType,
  type SaveScanDatasetInput,
  type ScanDatasetDetails,
  type ScanDatasetItemRecord,
  type ScanDatasetSummary,
  type ScanFieldMap,
  type ScanJobDetails,
  type ScanJobRecord,
  type ScanJobStatus,
  type ScanResultRecord,
  type ScanResultStatus,
  type ScanSource,
  type ScanType,
  type StartScanJobInput
} from '../../shared/scanner'

interface JobRow extends Record<string, unknown> {
  id: number
  scanType: string
  sourceType: string
  sourceAccountId: number | null
  sourceCredentialRef: string | null
  query: string
  filtersJson: string
  limitCount: number
  status: string
  resultCount: number
  acceptedCount: number
  message: string | null
  startedAt: number | null
  finishedAt: number | null
  createdAt: number
  updatedAt: number
}

function positiveId(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} không hợp lệ.`)
  return value
}

function parseObject(raw: string): ScanFieldMap {
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return value as ScanFieldMap
  } catch {
    return {}
  }
}

function validScanType(value: string): ScanType {
  if (!(SCAN_TYPES as readonly string[]).includes(value)) throw new Error(`Scan type không hợp lệ: ${value}`)
  return value as ScanType
}

function validJobStatus(value: string): ScanJobStatus {
  if (!(SCAN_JOB_STATUSES as readonly string[]).includes(value)) throw new Error(`Scan status không hợp lệ: ${value}`)
  return value as ScanJobStatus
}

function validResultStatus(value: string): ScanResultStatus {
  if (!(SCAN_RESULT_STATUSES as readonly string[]).includes(value)) throw new Error(`Scan result status không hợp lệ: ${value}`)
  return value as ScanResultStatus
}

function normalizeLimit(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.min(50_000, Math.max(1, Math.floor(value)))
}

function normalizeSource(client: Database.Database, source: ScanSource): ScanSource {
  if (source.type === 'account') {
    if (source.accountId === null) return { type: 'account', accountId: null }
    const accountId = positiveId(source.accountId, 'Account ID')
    if (!client.prepare('SELECT 1 FROM accounts WHERE id = ?').get(accountId)) {
      throw new Error(`Không tìm thấy account #${accountId}.`)
    }
    return { type: 'account', accountId }
  }
  const credentialId = source.credentialId?.trim() || null
  return { type: 'token', credentialId }
}

function sourceFromRow(row: JobRow): ScanSource {
  return row.sourceType === 'token'
    ? { type: 'token', credentialId: row.sourceCredentialRef }
    : { type: 'account', accountId: row.sourceAccountId }
}

function jobFromRow(row: JobRow): ScanJobRecord {
  return {
    id: Number(row.id),
    scanType: validScanType(String(row.scanType)),
    source: sourceFromRow(row),
    query: String(row.query),
    filters: parseObject(String(row.filtersJson)),
    limit: Number(row.limitCount),
    status: validJobStatus(String(row.status)),
    resultCount: Number(row.resultCount),
    acceptedCount: Number(row.acceptedCount),
    message: row.message === null ? null : String(row.message),
    startedAt: row.startedAt === null ? null : Number(row.startedAt),
    finishedAt: row.finishedAt === null ? null : Number(row.finishedAt),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt)
  }
}

function terminal(status: ScanJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped' || status === 'needs_attention'
}

export class ScannerRepository {
  constructor(private readonly client: Database.Database) {}

  recoverInterrupted(now = Date.now()): number {
    return this.client.prepare(`
      UPDATE scan_jobs
      SET status = 'needs_attention',
          message = 'Phiên quét bị ngắt khi ứng dụng đóng. Hãy chạy lại từ snapshot nguồn.',
          finished_at = ?,
          updated_at = ?
      WHERE status IN ('queued', 'running', 'paused')
    `).run(now, now).changes
  }

  createJob(input: StartScanJobInput, now = Date.now()): ScanJobDetails {
    const scanType = validScanType(input.scanType)
    const source = normalizeSource(this.client, input.source)
    const query = input.query.trim()
    const filtersJson = JSON.stringify(input.filters ?? {})
    const limit = normalizeLimit(input.limit)
    const result = this.client.prepare(`
      INSERT INTO scan_jobs(
        scan_type, source_type, source_account_id, source_credential_ref,
        query, filters_json, limit_count, status,
        result_count, accepted_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, 0, ?, ?)
    `).run(
      scanType,
      source.type,
      source.type === 'account' ? source.accountId : null,
      source.type === 'token' ? source.credentialId : null,
      query,
      filtersJson,
      limit,
      now,
      now
    )
    return this.requireJob(Number(result.lastInsertRowid))
  }

  getJob(id: number): ScanJobDetails | null {
    positiveId(id, 'Scan job ID')
    const row = this.client.prepare(`
      SELECT
        id,
        scan_type AS scanType,
        source_type AS sourceType,
        source_account_id AS sourceAccountId,
        source_credential_ref AS sourceCredentialRef,
        query,
        filters_json AS filtersJson,
        limit_count AS limitCount,
        status,
        result_count AS resultCount,
        accepted_count AS acceptedCount,
        message,
        started_at AS startedAt,
        finished_at AS finishedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM scan_jobs
      WHERE id = ?
    `).get(id) as JobRow | undefined
    if (!row) return null
    return { ...jobFromRow(row), results: this.listResults(id) }
  }

  setJobStatus(id: number, status: ScanJobStatus, message: string | null = null, now = Date.now()): ScanJobDetails {
    positiveId(id, 'Scan job ID')
    validJobStatus(status)
    const current = this.requireJob(id)
    const startedAt = status === 'running' ? (current.startedAt ?? now) : current.startedAt
    const finishedAt = terminal(status) ? now : null
    this.client.prepare(`
      UPDATE scan_jobs
      SET status = ?, message = ?, started_at = ?, finished_at = ?, updated_at = ?
      WHERE id = ?
    `).run(status, message, startedAt, finishedAt, now, id)
    return this.requireJob(id)
  }

  addResult(
    jobId: number,
    input: Omit<ScanResultRecord, 'id' | 'jobId' | 'scanType'>,
    now = Date.now()
  ): ScanResultRecord | null {
    const job = this.requireJob(jobId)
    const entityId = input.entityId.trim()
    if (!entityId) throw new Error('Entity ID của kết quả quét là bắt buộc.')
    const displayName = input.displayName.trim() || entityId
    const url = input.url?.trim() || null
    const status = validResultStatus(input.status)
    const scannedAt = Number.isFinite(input.scannedAt) ? Math.floor(input.scannedAt) : now
    const insert = this.client.prepare(`
      INSERT INTO scan_job_results(job_id, entity_id, display_name, url, result_status, data_json, scanned_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id, entity_id) DO NOTHING
    `).run(jobId, entityId, displayName, url, status, JSON.stringify(input.data ?? {}), scannedAt)
    if (insert.changes === 0) return null

    const accepted = status === 'success' || status === 'partial_success' ? 1 : 0
    this.client.prepare(`
      UPDATE scan_jobs
      SET result_count = result_count + 1,
          accepted_count = accepted_count + ?,
          updated_at = ?
      WHERE id = ?
    `).run(accepted, now, jobId)

    const row = this.client.prepare(`
      SELECT id, job_id AS jobId, entity_id AS entityId, display_name AS displayName,
             url, result_status AS status, data_json AS dataJson, scanned_at AS scannedAt
      FROM scan_job_results
      WHERE id = ?
    `).get(Number(insert.lastInsertRowid)) as Record<string, unknown> | undefined
    return row ? this.resultFromRow(row, job.scanType) : null
  }

  listResults(jobId: number): ScanResultRecord[] {
    const job = this.getJobRow(jobId)
    if (!job) return []
    const scanType = validScanType(String(job.scanType))
    const rows = this.client.prepare(`
      SELECT id, job_id AS jobId, entity_id AS entityId, display_name AS displayName,
             url, result_status AS status, data_json AS dataJson, scanned_at AS scannedAt
      FROM scan_job_results
      WHERE job_id = ?
      ORDER BY id
    `).all(jobId) as Array<Record<string, unknown>>
    return rows.map((row) => this.resultFromRow(row, scanType))
  }

  listDatasets(): ScanDatasetSummary[] {
    const rows = this.client.prepare(`
      SELECT d.id, d.dataset_type AS type, d.name, d.source_job_id AS sourceJobId,
             d.created_at AS createdAt, d.updated_at AS updatedAt,
             COUNT(i.id) AS recordCount
      FROM scan_datasets d
      LEFT JOIN scan_dataset_items i ON i.dataset_id = d.id
      GROUP BY d.id
      ORDER BY d.updated_at DESC, d.id DESC
    `).all() as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: Number(row.id),
      type: String(row.type) as ScanDatasetSummary['type'],
      name: String(row.name),
      recordCount: Number(row.recordCount),
      sourceJobId: row.sourceJobId === null ? null : Number(row.sourceJobId),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt)
    }))
  }

  getDataset(id: number): ScanDatasetDetails | null {
    positiveId(id, 'Dataset ID')
    const summary = this.listDatasets().find((item) => item.id === id)
    if (!summary) return null
    const rows = this.client.prepare(`
      SELECT id, dataset_id AS datasetId, entity_id AS entityId, display_name AS displayName,
             url, data_json AS dataJson, source_job_id AS sourceJobId, created_at AS createdAt
      FROM scan_dataset_items
      WHERE dataset_id = ?
      ORDER BY id
    `).all(id) as Array<Record<string, unknown>>
    const items: ScanDatasetItemRecord[] = rows.map((row) => ({
      id: Number(row.id),
      datasetId: Number(row.datasetId),
      entityId: String(row.entityId),
      displayName: String(row.displayName),
      url: row.url === null ? null : String(row.url),
      data: parseObject(String(row.dataJson)),
      sourceJobId: row.sourceJobId === null ? null : Number(row.sourceJobId),
      createdAt: Number(row.createdAt)
    }))
    return { ...summary, items }
  }

  createDatasetFromJob(input: SaveScanDatasetInput, now = Date.now()): ScanDatasetDetails {
    const job = this.requireJob(input.jobId)
    const name = input.name.trim()
    if (!name) throw new Error('Tên Dataset là bắt buộc.')
    if (name.length > 160) throw new Error('Tên Dataset tối đa 160 ký tự.')
    if (job.results.length === 0) throw new Error('Phiên quét chưa có kết quả để lưu Dataset.')

    let results = job.results
    if (input.resultIds !== undefined) {
      const requestedIds = new Set(input.resultIds.map((id) => positiveId(id, 'Scan result ID')))
      results = job.results.filter((result) => requestedIds.has(result.id))
      if (requestedIds.size !== results.length) {
        throw new Error('Danh sách kết quả được chọn có record không thuộc phiên quét hiện tại.')
      }
      if (results.length === 0) throw new Error('Hãy chọn ít nhất một kết quả để lưu Dataset.')
    }

    const create = this.client.transaction(() => {
      const inserted = this.client.prepare(`
        INSERT INTO scan_datasets(dataset_type, name, source_job_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(datasetTypeForScanType(job.scanType), name, job.id, now, now)
      const datasetId = Number(inserted.lastInsertRowid)
      const addItem = this.client.prepare(`
        INSERT INTO scan_dataset_items(
          dataset_id, entity_id, display_name, url, data_json, source_job_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const result of results) {
        addItem.run(datasetId, result.entityId, result.displayName, result.url, JSON.stringify(result.data), job.id, now)
      }
      return datasetId
    })

    const created = this.getDataset(create())
    if (!created) throw new Error('Không thể đọc lại Dataset vừa tạo.')
    return created
  }

  private getJobRow(id: number): JobRow | null {
    positiveId(id, 'Scan job ID')
    const row = this.client.prepare(`
      SELECT
        id,
        scan_type AS scanType,
        source_type AS sourceType,
        source_account_id AS sourceAccountId,
        source_credential_ref AS sourceCredentialRef,
        query,
        filters_json AS filtersJson,
        limit_count AS limitCount,
        status,
        result_count AS resultCount,
        accepted_count AS acceptedCount,
        message,
        started_at AS startedAt,
        finished_at AS finishedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM scan_jobs
      WHERE id = ?
    `).get(id) as JobRow | undefined
    return row ?? null
  }

  private requireJob(id: number): ScanJobDetails {
    const record = this.getJob(id)
    if (!record) throw new Error(`Không tìm thấy phiên quét #${id}.`)
    return record
  }

  private resultFromRow(row: Record<string, unknown>, scanType: ScanType): ScanResultRecord {
    return {
      id: Number(row.id),
      jobId: Number(row.jobId),
      scanType,
      entityId: String(row.entityId),
      displayName: String(row.displayName),
      url: row.url === null ? null : String(row.url),
      status: validResultStatus(String(row.status)),
      data: parseObject(String(row.dataJson)),
      scannedAt: Number(row.scannedAt)
    }
  }
}
