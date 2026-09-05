import type Database from 'better-sqlite3'
import type {
  PageWallRecurringPlanRecord,
  PageWallRecurringPlanSource,
  SavePageWallRecurringPlanInput
} from '../../shared/pageWallRecurring'
import { normalizePageWallRecurringSchedules } from '../../shared/pageWallRecurring'
import type { PageWallJobRecord } from '../../shared/pageWallJobs'
import { PageWallJobRepository, type CreatePageWallJobInput } from './pageWallJobRepository'

interface PageWallRecurringPlanRow {
  id: number
  pageTabId: number
  enabled: number
  accountId: number
  sourceJson: string
  schedulesJson: string
  lastError: string | null
  createdAt: number
  updatedAt: number
}

function normalizeImagePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const raw of Array.isArray(paths) ? paths : []) {
    if (typeof raw !== 'string') continue
    const path = raw.trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    normalized.push(path)
  }
  return normalized
}

function sourceFromInput(input: SavePageWallRecurringPlanInput): PageWallRecurringPlanSource {
  return {
    content: typeof input.content === 'string' ? input.content : '',
    imagePaths: normalizeImagePaths(input.imagePaths),
    ...(input.canonicalPost ? { canonicalPost: JSON.parse(JSON.stringify(input.canonicalPost)) as NonNullable<PageWallRecurringPlanSource['canonicalPost']> } : {})
  }
}

function parseSource(value: string): PageWallRecurringPlanSource {
  try {
    const parsed = JSON.parse(value) as Partial<PageWallRecurringPlanSource>
    return {
      content: typeof parsed.content === 'string' ? parsed.content : '',
      imagePaths: normalizeImagePaths(Array.isArray(parsed.imagePaths) ? parsed.imagePaths : []),
      ...(parsed.canonicalPost && typeof parsed.canonicalPost === 'object'
        ? { canonicalPost: parsed.canonicalPost }
        : {})
    }
  } catch {
    return { content: '', imagePaths: [] }
  }
}

function rowToRecord(row: PageWallRecurringPlanRow): PageWallRecurringPlanRecord {
  const source = parseSource(row.sourceJson)
  let schedules: PageWallRecurringPlanRecord['schedules'] = []
  try {
    const parsed = JSON.parse(row.schedulesJson) as PageWallRecurringPlanRecord['schedules']
    schedules = normalizePageWallRecurringSchedules(parsed)
  } catch {
    schedules = []
  }
  return {
    id: row.id,
    pageTabId: row.pageTabId,
    accountId: row.accountId,
    enabled: row.enabled === 1,
    content: source.content,
    imagePaths: source.imagePaths,
    ...(source.canonicalPost ? { canonicalPost: source.canonicalPost } : {}),
    schedules,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

const selectColumns = `
  id, page_tab_id AS pageTabId, enabled, account_id AS accountId,
  source_json AS sourceJson, schedules_json AS schedulesJson,
  last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt
`

export class PageWallRecurringRepository {
  private readonly jobs: PageWallJobRepository

  constructor(
    private readonly client: Database.Database,
    jobs?: PageWallJobRepository
  ) {
    this.jobs = jobs ?? new PageWallJobRepository(client)
  }

  get(pageTabId: number): PageWallRecurringPlanRecord | null {
    const row = this.client.prepare(`
      SELECT ${selectColumns}
      FROM page_wall_recurring_plans
      WHERE page_tab_id = ?
    `).get(pageTabId) as PageWallRecurringPlanRow | undefined
    return row ? rowToRecord(row) : null
  }

  listEnabled(): PageWallRecurringPlanRecord[] {
    const rows = this.client.prepare(`
      SELECT ${selectColumns}
      FROM page_wall_recurring_plans
      WHERE enabled = 1
      ORDER BY page_tab_id ASC
    `).all() as PageWallRecurringPlanRow[]
    return rows.map(rowToRecord)
  }

  save(input: SavePageWallRecurringPlanInput, now = Date.now()): PageWallRecurringPlanRecord {
    if (!Number.isInteger(input.pageTabId) || input.pageTabId <= 0) throw new Error('Page của lịch Tường không hợp lệ.')
    if (!Number.isInteger(input.accountId) || input.accountId <= 0) throw new Error('Tài khoản của lịch Tường không hợp lệ.')
    const schedules = normalizePageWallRecurringSchedules(input.schedules)
    if (input.enabled && !schedules.some((schedule) => schedule.enabled)) {
      throw new Error('Lịch chạy đang bật cần ít nhất một khung giờ bật.')
    }
    const source = sourceFromInput(input)

    this.client.prepare(`
      INSERT INTO page_wall_recurring_plans (
        page_tab_id, enabled, account_id, source_json, schedules_json,
        last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(page_tab_id) DO UPDATE SET
        enabled = excluded.enabled,
        account_id = excluded.account_id,
        source_json = excluded.source_json,
        schedules_json = excluded.schedules_json,
        last_error = NULL,
        updated_at = excluded.updated_at
    `).run(
      input.pageTabId,
      input.enabled ? 1 : 0,
      input.accountId,
      JSON.stringify(source),
      JSON.stringify(schedules),
      now,
      now
    )

    const saved = this.get(input.pageTabId)
    if (!saved) throw new Error('Không thể đọc lại lịch chạy Tường vừa lưu.')
    return saved
  }

  clear(pageTabId: number): boolean {
    if (!Number.isInteger(pageTabId) || pageTabId <= 0) throw new Error('Page của lịch Tường không hợp lệ.')
    return this.client.prepare('DELETE FROM page_wall_recurring_plans WHERE page_tab_id = ?')
      .run(pageTabId).changes > 0
  }

  setLastError(planId: number, message: string | null, now = Date.now()): void {
    this.client.prepare(`
      UPDATE page_wall_recurring_plans
      SET last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(message, now, planId)
  }

  occurrenceExists(planId: number, occurrenceKey: string): boolean {
    return Boolean(this.client.prepare(`
      SELECT 1 FROM page_wall_recurring_occurrences
      WHERE plan_id = ? AND occurrence_key = ?
    `).get(planId, occurrenceKey))
  }

  createOccurrenceJob(
    planId: number,
    occurrenceKey: string,
    input: CreatePageWallJobInput,
    now = Date.now()
  ): PageWallJobRecord | null {
    const create = this.client.transaction(() => {
      if (this.occurrenceExists(planId, occurrenceKey)) return null
      const job = this.jobs.create(input, now)
      this.client.prepare(`
        INSERT INTO page_wall_recurring_occurrences (
          plan_id, occurrence_key, job_id, created_at
        ) VALUES (?, ?, ?, ?)
      `).run(planId, occurrenceKey, job.id, now)
      return job
    })
    return create()
  }
}
