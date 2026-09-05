import type Database from 'better-sqlite3'
import type {
  PageWallPlanOccurrenceRecord,
  PageWallPlanRecord,
  PageWallPlanStatus,
  PageWallPlanTaskDefinition,
  SavePageWallPlanInput
} from '../../shared/pageWallPlans'
import {
  normalizePageWallPlanInput,
  normalizePageWallPlanLocalDate,
  normalizePageWallPlanTasks,
  PAGE_WALL_PLAN_STATUSES,
  pageWallPlanOccurrenceKey
} from '../../shared/pageWallPlans'
import type { PageWallJobRecord } from '../../shared/pageWallJobs'
import { PageWallJobRepository, type CreatePageWallJobInput } from './pageWallJobRepository'

interface PageWallPlanRow {
  id: number
  pageTabId: number
  scheduleKind: string
  localDate: string | null
  minuteOfDay: number
  accountConcurrency: number
  taskDefinitionsJson: string
  status: string
  lastError: string | null
  createdAt: number
  updatedAt: number
}

interface PageWallPlanOccurrenceRow {
  id: number
  planId: number
  occurrenceKey: string
  localDate: string
  scheduledAt: number
  status: string
  accountConcurrency: number
  taskCount: number
  resultMessage: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  updatedAt: number
}

export interface CreatePageWallPlanOccurrenceInput {
  planId: number
  localDate: string
  scheduledAt: number
  /** Concrete immutable tasks, already resolved from canonical account/post state. */
  jobs: CreatePageWallJobInput[]
}

export interface PageWallOccurrenceConcreteJob {
  taskOrder: number
  job: PageWallJobRecord
}

export interface PageWallPlanOccurrenceWithJobs {
  occurrence: PageWallPlanOccurrenceRecord
  jobs: PageWallOccurrenceConcreteJob[]
}

const planSelectColumns = `
  id, page_tab_id AS pageTabId, schedule_kind AS scheduleKind, local_date AS localDate,
  minute_of_day AS minuteOfDay, account_concurrency AS accountConcurrency,
  task_definitions_json AS taskDefinitionsJson, status, last_error AS lastError,
  created_at AS createdAt, updated_at AS updatedAt
`

const occurrenceSelectColumns = `
  id, plan_id AS planId, occurrence_key AS occurrenceKey, local_date AS localDate,
  scheduled_at AS scheduledAt, status, account_concurrency AS accountConcurrency,
  task_count AS taskCount, result_message AS resultMessage, created_at AS createdAt,
  started_at AS startedAt, finished_at AS finishedAt, updated_at AS updatedAt
`

function parseTasks(value: string): PageWallPlanTaskDefinition[] {
  try {
    const parsed = JSON.parse(value) as PageWallPlanTaskDefinition[]
    return normalizePageWallPlanTasks(parsed)
  } catch {
    return []
  }
}

function rowToPlan(row: PageWallPlanRow): PageWallPlanRecord {
  const tasks = parseTasks(row.taskDefinitionsJson)
  return {
    id: row.id,
    pageTabId: row.pageTabId,
    scheduleKind: row.scheduleKind as PageWallPlanRecord['scheduleKind'],
    localDate: row.localDate,
    minuteOfDay: row.minuteOfDay,
    accountConcurrency: row.accountConcurrency,
    tasks,
    taskCount: tasks.length,
    status: row.status as PageWallPlanStatus,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function rowToOccurrence(row: PageWallPlanOccurrenceRow): PageWallPlanOccurrenceRecord {
  return {
    id: row.id,
    planId: row.planId,
    occurrenceKey: row.occurrenceKey,
    localDate: row.localDate,
    scheduledAt: row.scheduledAt,
    status: row.status as PageWallPlanOccurrenceRecord['status'],
    accountConcurrency: row.accountConcurrency,
    taskCount: row.taskCount,
    resultMessage: row.resultMessage,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    updatedAt: row.updatedAt
  }
}

function assertPlanStatus(status: PageWallPlanStatus): void {
  if (!PAGE_WALL_PLAN_STATUSES.includes(status)) throw new Error('Trạng thái kế hoạch Đăng Tường không hợp lệ.')
}

export class PageWallPlanRepository {
  private readonly jobs: PageWallJobRepository

  constructor(
    private readonly client: Database.Database,
    jobs?: PageWallJobRepository
  ) {
    this.jobs = jobs ?? new PageWallJobRepository(client)
  }

  get(id: number): PageWallPlanRecord | null {
    const row = this.client.prepare(`
      SELECT ${planSelectColumns}
      FROM page_wall_plans
      WHERE id = ?
    `).get(id) as PageWallPlanRow | undefined
    return row ? rowToPlan(row) : null
  }

  listByPage(pageTabId: number): PageWallPlanRecord[] {
    if (!Number.isInteger(pageTabId) || pageTabId <= 0) throw new Error('Page của kế hoạch không hợp lệ.')
    const rows = this.client.prepare(`
      SELECT ${planSelectColumns}
      FROM page_wall_plans
      WHERE page_tab_id = ?
      ORDER BY
        CASE status WHEN 'active' THEN 0 WHEN 'needs_attention' THEN 1 WHEN 'disabled' THEN 2 ELSE 3 END,
        CASE schedule_kind WHEN 'specific_date' THEN 0 ELSE 1 END,
        COALESCE(local_date, '9999-12-31'), minute_of_day, id
    `).all(pageTabId) as PageWallPlanRow[]
    return rows.map(rowToPlan)
  }

  create(input: SavePageWallPlanInput, now = Date.now()): PageWallPlanRecord {
    const normalized = normalizePageWallPlanInput(input)
    const status: PageWallPlanStatus = normalized.enabled ? 'active' : 'disabled'
    const result = this.client.prepare(`
      INSERT INTO page_wall_plans (
        page_tab_id, schedule_kind, local_date, minute_of_day, account_concurrency,
        task_definitions_json, status, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      normalized.pageTabId,
      normalized.scheduleKind,
      normalized.localDate ?? null,
      normalized.minuteOfDay,
      normalized.accountConcurrency,
      JSON.stringify(normalized.tasks),
      status,
      now,
      now
    )
    const created = this.get(Number(result.lastInsertRowid))
    if (!created) throw new Error('Không thể đọc lại kế hoạch Đăng Tường vừa tạo.')
    return created
  }

  update(id: number, input: SavePageWallPlanInput, now = Date.now()): PageWallPlanRecord {
    if (!Number.isInteger(id) || id <= 0) throw new Error('Kế hoạch Đăng Tường không hợp lệ.')
    const normalized = normalizePageWallPlanInput(input)
    const status: PageWallPlanStatus = normalized.enabled ? 'active' : 'disabled'
    const updated = this.client.prepare(`
      UPDATE page_wall_plans
      SET page_tab_id = ?, schedule_kind = ?, local_date = ?, minute_of_day = ?,
          account_concurrency = ?, task_definitions_json = ?, status = ?, last_error = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(
      normalized.pageTabId,
      normalized.scheduleKind,
      normalized.localDate ?? null,
      normalized.minuteOfDay,
      normalized.accountConcurrency,
      JSON.stringify(normalized.tasks),
      status,
      now,
      id
    )
    if (updated.changes !== 1) throw new Error(`Không tìm thấy kế hoạch Đăng Tường #${id}.`)
    const record = this.get(id)
    if (!record) throw new Error(`Không thể đọc lại kế hoạch Đăng Tường #${id} sau khi cập nhật.`)
    return record
  }

  delete(id: number): boolean {
    if (!Number.isInteger(id) || id <= 0) throw new Error('Kế hoạch Đăng Tường không hợp lệ.')
    return this.client.prepare('DELETE FROM page_wall_plans WHERE id = ?').run(id).changes > 0
  }

  setStatus(id: number, status: PageWallPlanStatus, lastError: string | null, now = Date.now()): PageWallPlanRecord {
    assertPlanStatus(status)
    const updated = this.client.prepare(`
      UPDATE page_wall_plans
      SET status = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(status, lastError, now, id)
    if (updated.changes !== 1) throw new Error(`Không tìm thấy kế hoạch Đăng Tường #${id}.`)
    const record = this.get(id)
    if (!record) throw new Error(`Không thể đọc lại kế hoạch Đăng Tường #${id} sau khi đổi trạng thái.`)
    return record
  }

  getOccurrence(id: number): PageWallPlanOccurrenceRecord | null {
    const row = this.client.prepare(`
      SELECT ${occurrenceSelectColumns}
      FROM page_wall_plan_occurrences
      WHERE id = ?
    `).get(id) as PageWallPlanOccurrenceRow | undefined
    return row ? rowToOccurrence(row) : null
  }

  listOccurrences(planId: number, limit = 100): PageWallPlanOccurrenceRecord[] {
    const safeLimit = Math.max(1, Math.min(1_000, Math.floor(limit)))
    const rows = this.client.prepare(`
      SELECT ${occurrenceSelectColumns}
      FROM page_wall_plan_occurrences
      WHERE plan_id = ?
      ORDER BY local_date DESC, id DESC
      LIMIT ?
    `).all(planId, safeLimit) as PageWallPlanOccurrenceRow[]
    return rows.map(rowToOccurrence)
  }

  occurrenceExists(planId: number, localDate: string): boolean {
    const occurrenceKey = pageWallPlanOccurrenceKey(localDate)
    return Boolean(this.client.prepare(`
      SELECT 1
      FROM page_wall_plan_occurrences
      WHERE plan_id = ? AND occurrence_key = ?
    `).get(planId, occurrenceKey))
  }

  createOccurrenceWithJobs(
    input: CreatePageWallPlanOccurrenceInput,
    now = Date.now()
  ): PageWallPlanOccurrenceWithJobs | null {
    if (!Number.isInteger(input.planId) || input.planId <= 0) throw new Error('Kế hoạch Đăng Tường không hợp lệ.')
    if (!Number.isFinite(input.scheduledAt) || input.scheduledAt <= 0) throw new Error('Thời điểm occurrence Đăng Tường không hợp lệ.')
    const localDate = normalizePageWallPlanLocalDate(input.localDate)
    const occurrenceKey = pageWallPlanOccurrenceKey(localDate)

    const create = this.client.transaction(() => {
      const plan = this.get(input.planId)
      if (!plan) throw new Error(`Không tìm thấy kế hoạch Đăng Tường #${input.planId}.`)
      if (plan.scheduleKind === 'specific_date' && plan.localDate !== localDate) {
        throw new Error('Ngày occurrence không khớp ngày cụ thể của kế hoạch Đăng Tường.')
      }
      if (input.jobs.length !== plan.taskCount) {
        throw new Error('Số concrete job không khớp task hữu hạn đã lưu trong kế hoạch Đăng Tường.')
      }
      if (this.occurrenceExists(plan.id, localDate)) return null

      const occurrenceInsert = this.client.prepare(`
        INSERT INTO page_wall_plan_occurrences (
          plan_id, occurrence_key, local_date, scheduled_at, status,
          account_concurrency, task_count, result_message,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL, ?, ?)
      `).run(
        plan.id,
        occurrenceKey,
        localDate,
        input.scheduledAt,
        plan.accountConcurrency,
        input.jobs.length,
        now,
        now
      )
      const occurrenceId = Number(occurrenceInsert.lastInsertRowid)

      const concreteJobs: PageWallOccurrenceConcreteJob[] = []
      for (let taskOrder = 0; taskOrder < input.jobs.length; taskOrder += 1) {
        const definition = plan.tasks[taskOrder]
        const jobInput = input.jobs[taskOrder]
        if (!definition || !jobInput) throw new Error('Task occurrence Đăng Tường không đầy đủ.')
        if (jobInput.pageTabId !== plan.pageTabId) {
          throw new Error('Concrete job không thuộc đúng Page của kế hoạch Đăng Tường.')
        }
        if (jobInput.accountId !== definition.accountId) {
          throw new Error('Concrete job không giữ đúng mapping tài khoản của kế hoạch Đăng Tường.')
        }
        if (jobInput.scheduledAt !== input.scheduledAt) {
          throw new Error('Concrete job không giữ đúng thời điểm của occurrence Đăng Tường.')
        }

        const job = this.jobs.create(jobInput, now)
        this.client.prepare(`
          INSERT INTO page_wall_plan_occurrence_jobs (occurrence_id, job_id, task_order)
          VALUES (?, ?, ?)
        `).run(occurrenceId, job.id, taskOrder)
        concreteJobs.push({ taskOrder, job })
      }

      const occurrence = this.getOccurrence(occurrenceId)
      if (!occurrence) throw new Error('Không thể đọc lại occurrence Đăng Tường vừa tạo.')
      return { occurrence, jobs: concreteJobs }
    })

    return create()
  }

  listOccurrenceJobs(occurrenceId: number): PageWallOccurrenceConcreteJob[] {
    const links = this.client.prepare(`
      SELECT job_id AS jobId, task_order AS taskOrder
      FROM page_wall_plan_occurrence_jobs
      WHERE occurrence_id = ?
      ORDER BY task_order ASC
    `).all(occurrenceId) as Array<{ jobId: number; taskOrder: number }>

    return links.map((link) => {
      const job = this.jobs.get(link.jobId)
      if (!job) throw new Error(`Không tìm thấy concrete Page Wall job #${link.jobId}.`)
      return { taskOrder: link.taskOrder, job }
    })
  }
}
