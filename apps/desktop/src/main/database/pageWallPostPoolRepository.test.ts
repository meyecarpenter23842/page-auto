import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from './index'
import { PageWallPlanRepository } from './pageWallPlanRepository'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Page Wall schedule post pool persistence', () => {
  it('persists one shared pool across plan slots and counts prior group occurrences', () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-auto-wall-post-pool-'))
    directories.push(directory)
    const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
    runtime.client.prepare("INSERT INTO page_tabs(name, page_uid, created_at, updated_at) VALUES ('P', '9001', 1, 1)").run()
    const pageTabId = Number((runtime.client.prepare('SELECT id FROM page_tabs LIMIT 1').get() as { id: number }).id)
    const plans = new PageWallPlanRepository(runtime.client)
    const task = { accountId: 1, sortOrder: 0, source: { kind: 'canonical' as const, postId: 11, variantIndex: 0 } }
    const first = plans.create({ pageTabId, scheduleKind: 'daily', minuteOfDay: 480, accountConcurrency: 1, tasks: [task], enabled: true }, 10)
    const second = plans.create({ pageTabId, scheduleKind: 'daily', minuteOfDay: 720, accountConcurrency: 1, tasks: [task], enabled: true }, 11)

    const input = {
      groupKey: 'wall-pool:persist',
      mode: 'random' as const,
      posts: [
        { kind: 'canonical' as const, postId: 11, variantIndex: 0 },
        { kind: 'canonical' as const, postId: 22, variantIndex: 0 }
      ]
    }
    plans.saveSchedulePostPool(first.id, { ...input, slotOrder: 0 })
    plans.saveSchedulePostPool(second.id, { ...input, slotOrder: 1 })

    expect(plans.getSchedulePostPool(first.id)).toMatchObject({ groupKey: input.groupKey, slotOrder: 0, mode: 'random' })
    expect(plans.getSchedulePostPool(second.id)?.posts.map((post) => post.postId)).toEqual([11, 22])

    runtime.client.prepare(`
      INSERT INTO page_wall_plan_occurrences(
        plan_id, occurrence_key, local_date, scheduled_at, status, account_concurrency,
        task_count, result_message, created_at, updated_at
      ) VALUES (?, '2026-09-18', '2026-09-18', 1000, 'success', 1, 1, NULL, 1000, 1000)
    `).run(first.id)
    expect(plans.countScheduleGroupOccurrencesBefore(input.groupKey, 1500)).toBe(1)
    expect(plans.countScheduleGroupOccurrencesBefore(input.groupKey, 500)).toBe(0)

    plans.delete(first.id)
    expect(plans.getSchedulePostPool(first.id)).toBeNull()
    runtime.close()
  })
})
