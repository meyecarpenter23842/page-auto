import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PageWallRunNowPayload } from '../../shared/pageWall'
import {
  activePageWallRecurringWindow,
  normalizePageWallRecurringSchedules,
  pageWallRecurringOccurrenceKey,
  type PageWallRecurringScheduleWindow
} from '../../shared/pageWallRecurring'
import { initializeDatabase } from '../database'
import { PageWallJobRepository } from '../database/pageWallJobRepository'
import { PageWallRecurringRepository } from '../database/pageWallRecurringRepository'
import type { PageWallPreparationResult } from './pageWallRunNowService'
import { PageWallRecurringService } from './pageWallRecurringService'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-wall-recurring-compat-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  const now = new Date(2026, 8, 4, 10, 30, 0, 0)
  const nowMs = now.getTime()

  runtime.client.prepare(`
    INSERT INTO accounts (id, uid, status, created_at, updated_at)
    VALUES (11, '10001', 'valid', ?, ?)
  `).run(nowMs, nowMs)
  runtime.client.prepare(`
    INSERT INTO page_tabs (
      id, name, page_uid, status, posts_per_account,
      post_delay_min_seconds, post_delay_max_seconds,
      account_delay_min_seconds, account_delay_max_seconds,
      created_at, updated_at
    ) VALUES (7, 'Page A', '90001', 'idle', 1, 1, 1, 1, 1, ?, ?)
  `).run(nowMs, nowMs)

  const jobs = new PageWallJobRepository(runtime.client)
  const plans = new PageWallRecurringRepository(runtime.client, jobs)
  const prepare = vi.fn(async (payload: PageWallRunNowPayload): Promise<PageWallPreparationResult> => ({
    ok: true,
    prepared: {
      input: {
        accountId: payload.accountId ?? 11,
        pageUid: '90001',
        content: payload.content,
        imagePaths: [...payload.imagePaths]
      },
      pageTabName: 'Page A',
      accountUid: '10001',
      accountName: null
    }
  }))
  const wake = vi.fn(async () => undefined)
  const service = new PageWallRecurringService(plans, { prepare }, wake, {
    autoStart: true,
    now: () => nowMs
  })
  const window: PageWallRecurringScheduleWindow = {
    dayOfWeek: now.getDay(),
    startMinute: 10 * 60,
    endMinute: 11 * 60,
    enabled: true,
    sortOrder: 0
  }
  return { runtime, jobs, service, prepare, wake, window }
}

describe('Page Wall recurring schedule helpers', () => {
  it('keeps legacy helper behavior stable for existing v21 data', () => {
    const now = new Date(2026, 8, 4, 10, 30, 0, 0)
    const window: PageWallRecurringScheduleWindow = {
      dayOfWeek: now.getDay(), startMinute: 600, endMinute: 660, enabled: true, sortOrder: 0
    }
    expect(activePageWallRecurringWindow([window], now)).toEqual(window)
    expect(pageWallRecurringOccurrenceKey(window, now)).toContain(':600-660')
    expect(() => normalizePageWallRecurringSchedules([
      { dayOfWeek: 1, startMinute: 600, endMinute: 660, enabled: true, sortOrder: 0 },
      { dayOfWeek: 1, startMinute: 630, endMinute: 700, enabled: true, sortOrder: 1 }
    ])).toThrow('chồng')
  })
})

describe('PageWallRecurringService v21 compatibility facade', () => {
  it('can read/write legacy v21 plans but never materializes jobs or starts a second scheduler', async () => {
    const prepared = setup()
    const saved = await prepared.service.save({
      pageTabId: 7,
      accountId: 11,
      enabled: true,
      content: 'legacy source',
      imagePaths: [],
      schedules: [prepared.window]
    })

    expect(saved.pageTabId).toBe(7)
    expect(prepared.service.get({ pageTabId: 7 })?.enabled).toBe(true)
    expect(await prepared.service.tick()).toBe(0)
    expect(prepared.jobs.list()).toHaveLength(0)
    expect(prepared.wake).not.toHaveBeenCalled()
    expect(prepared.prepare).toHaveBeenCalledTimes(1)

    prepared.service.dispose()
    prepared.runtime.close()
  })
})
