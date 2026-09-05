import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from './index'
import { PageWallJobRepository } from './pageWallJobRepository'
import { PageWallPlanRepository } from './pageWallPlanRepository'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-wall-plan-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  runtime.client.prepare(`
    INSERT INTO page_tabs (name, page_uid, created_at, updated_at)
    VALUES ('Page A', '90001', 1000, 1000)
  `).run()
  const pageTabId = Number((runtime.client.prepare('SELECT id FROM page_tabs LIMIT 1').get() as { id: number }).id)
  return {
    runtime,
    pageTabId,
    jobs: new PageWallJobRepository(runtime.client),
    plans: new PageWallPlanRepository(runtime.client)
  }
}

function manualTask(accountId: number, sortOrder: number, content = 'hello wall') {
  return {
    accountId,
    sortOrder,
    source: { kind: 'manual' as const, content, imagePaths: [] }
  }
}

function concreteJob(pageTabId: number, accountId: number, scheduledAt: number, suffix = '') {
  return {
    scheduledAt,
    pageTabId,
    pageTabName: 'Page A',
    pageUid: '90001',
    accountId,
    accountUid: `uid-${accountId}`,
    accountName: `Account ${accountId}`,
    content: `hello wall${suffix}`,
    imagePaths: []
  }
}

describe('PageWallPlanRepository finite plan model', () => {
  it('keeps v21 compatibility tables and stores multiple finite plans for one Page', () => {
    const { runtime, pageTabId, plans } = setup()
    const legacyPlanTable = runtime.client.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'page_wall_recurring_plans'
    `).get() as { name: string } | undefined
    const legacyOccurrenceTable = runtime.client.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'page_wall_recurring_occurrences'
    `).get() as { name: string } | undefined

    expect(legacyPlanTable?.name).toBe('page_wall_recurring_plans')
    expect(legacyOccurrenceTable?.name).toBe('page_wall_recurring_occurrences')

    const once = plans.create({
      pageTabId,
      scheduleKind: 'specific_date',
      localDate: '2026-09-07',
      minuteOfDay: 8 * 60 + 30,
      accountConcurrency: 2,
      enabled: true,
      tasks: [manualTask(12, 1, 'second'), manualTask(11, 0, 'first')]
    }, 1_000)
    const daily = plans.create({
      pageTabId,
      scheduleKind: 'daily',
      localDate: '2099-01-01',
      minuteOfDay: 9 * 60,
      accountConcurrency: 1,
      enabled: true,
      tasks: [{
        accountId: 13,
        sortOrder: 0,
        source: { kind: 'canonical', postId: 77, variantIndex: 2 }
      }]
    }, 2_000)

    expect(once).toMatchObject({
      scheduleKind: 'specific_date',
      localDate: '2026-09-07',
      accountConcurrency: 2,
      taskCount: 2,
      status: 'active'
    })
    expect(once.tasks.map((task) => task.accountId)).toEqual([11, 12])
    expect(daily.localDate).toBeNull()
    expect(plans.listByPage(pageTabId)).toHaveLength(2)

    runtime.close()
  })

  it('materializes one idempotent occurrence per plan/local date and links immutable jobs by task order', () => {
    const { runtime, pageTabId, plans } = setup()
    const plan = plans.create({
      pageTabId,
      scheduleKind: 'daily',
      minuteOfDay: 10 * 60,
      accountConcurrency: 2,
      enabled: true,
      tasks: [manualTask(21, 0), manualTask(22, 1)]
    }, 1_000)
    const scheduledAt = 10_000

    const first = plans.createOccurrenceWithJobs({
      planId: plan.id,
      localDate: '2026-09-08',
      scheduledAt,
      jobs: [
        concreteJob(pageTabId, 21, scheduledAt, ' A'),
        concreteJob(pageTabId, 22, scheduledAt, ' B')
      ]
    }, 2_000)

    expect(first?.occurrence).toMatchObject({
      planId: plan.id,
      occurrenceKey: '2026-09-08',
      localDate: '2026-09-08',
      status: 'pending',
      accountConcurrency: 2,
      taskCount: 2
    })
    expect(first?.jobs.map((entry) => [entry.taskOrder, entry.job.accountId])).toEqual([
      [0, 21],
      [1, 22]
    ])
    expect(plans.listOccurrenceJobs(first!.occurrence.id).map((entry) => entry.job.id))
      .toEqual(first!.jobs.map((entry) => entry.job.id))

    const duplicate = plans.createOccurrenceWithJobs({
      planId: plan.id,
      localDate: '2026-09-08',
      scheduledAt,
      jobs: [
        concreteJob(pageTabId, 21, scheduledAt, ' duplicate A'),
        concreteJob(pageTabId, 22, scheduledAt, ' duplicate B')
      ]
    }, 3_000)
    expect(duplicate).toBeNull()

    const counts = runtime.client.prepare(`
      SELECT
        (SELECT COUNT(*) FROM page_wall_plan_occurrences WHERE plan_id = ?) AS occurrences,
        (SELECT COUNT(*) FROM page_wall_plan_occurrence_jobs) AS links,
        (SELECT COUNT(*) FROM page_wall_jobs) AS jobs
    `).get(plan.id) as { occurrences: number; links: number; jobs: number }
    expect(counts).toEqual({ occurrences: 1, links: 2, jobs: 2 })

    runtime.close()
  })

  it('does not attach legacy one-shot jobs to a finite occurrence and rejects implicit task remapping', () => {
    const { runtime, pageTabId, jobs, plans } = setup()
    const legacy = jobs.create(concreteJob(pageTabId, 31, 5_000), 1_000)
    const plan = plans.create({
      pageTabId,
      scheduleKind: 'specific_date',
      localDate: '2026-09-09',
      minuteOfDay: 11 * 60,
      accountConcurrency: 1,
      enabled: true,
      tasks: [manualTask(32, 0)]
    }, 1_500)

    const legacyLink = runtime.client.prepare(`
      SELECT 1 FROM page_wall_plan_occurrence_jobs WHERE job_id = ?
    `).get(legacy.id)
    expect(legacyLink).toBeUndefined()

    expect(() => plans.createOccurrenceWithJobs({
      planId: plan.id,
      localDate: '2026-09-09',
      scheduledAt: 6_000,
      jobs: [concreteJob(pageTabId, 999, 6_000)]
    }, 2_000)).toThrow('mapping tài khoản')
    expect(runtime.client.prepare('SELECT COUNT(*) AS count FROM page_wall_plan_occurrences').get())
      .toEqual({ count: 0 })
    expect(runtime.client.prepare('SELECT COUNT(*) AS count FROM page_wall_jobs').get())
      .toEqual({ count: 1 })

    runtime.close()
  })

  it('validates finite schedule contracts instead of accepting time windows', () => {
    const { runtime, pageTabId, plans } = setup()
    expect(() => plans.create({
      pageTabId,
      scheduleKind: 'specific_date',
      localDate: null,
      minuteOfDay: 700,
      accountConcurrency: 1,
      enabled: true,
      tasks: [manualTask(41, 0)]
    })).toThrow('Ngày chạy')

    expect(() => plans.create({
      pageTabId,
      scheduleKind: 'daily',
      minuteOfDay: 700,
      accountConcurrency: 21,
      enabled: true,
      tasks: [manualTask(41, 0)]
    })).toThrow('TK chạy song song')

    runtime.close()
  })
})
