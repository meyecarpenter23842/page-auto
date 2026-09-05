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
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-wall-recurring-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  const now = new Date(2026, 8, 4, 10, 30, 0, 0)
  let nowMs = now.getTime()

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
        accountId: payload.accountId,
        pageUid: '90001',
        content: payload.canonicalPost?.content ?? payload.content,
        imagePaths: payload.canonicalPost ? ['C:\\resolved\\canonical.jpg'] : [...payload.imagePaths]
      },
      pageTabName: 'Page A',
      accountUid: '10001',
      accountName: 'Smoke Account'
    }
  }))
  const wake = vi.fn(async () => undefined)
  const service = new PageWallRecurringService(plans, { prepare }, wake, {
    autoStart: false,
    now: () => nowMs
  })
  const window: PageWallRecurringScheduleWindow = {
    dayOfWeek: now.getDay(),
    startMinute: 10 * 60,
    endMinute: 11 * 60,
    enabled: true,
    sortOrder: 0
  }

  return {
    runtime,
    jobs,
    plans,
    prepare,
    wake,
    service,
    window,
    now,
    setNow: (next: Date) => { nowMs = next.getTime() }
  }
}

describe('Page Wall recurring schedule helpers', () => {
  it('finds the active local window and produces a stable per-day occurrence key', () => {
    const now = new Date(2026, 8, 4, 10, 30, 0, 0)
    const window: PageWallRecurringScheduleWindow = {
      dayOfWeek: now.getDay(), startMinute: 600, endMinute: 660, enabled: true, sortOrder: 0
    }
    expect(activePageWallRecurringWindow([window], now)).toEqual(window)
    expect(pageWallRecurringOccurrenceKey(window, now)).toContain(':600-660')
  })

  it('rejects overlapping enabled windows on the same day', () => {
    expect(() => normalizePageWallRecurringSchedules([
      { dayOfWeek: 1, startMinute: 600, endMinute: 660, enabled: true, sortOrder: 0 },
      { dayOfWeek: 1, startMinute: 630, endMinute: 700, enabled: true, sortOrder: 1 }
    ])).toThrow('chồng')
  })
})

describe('PageWallRecurringService', () => {
  it('materializes exactly one immutable concrete job for an active window', async () => {
    const prepared = setup()
    await prepared.service.save({
      pageTabId: 7,
      accountId: 11,
      enabled: true,
      content: 'snapshot v1',
      imagePaths: ['C:\\media\\one.jpg'],
      schedules: [prepared.window]
    })

    expect(await prepared.service.tick()).toBe(1)
    expect(await prepared.service.tick()).toBe(0)
    expect(prepared.jobs.list()).toHaveLength(1)
    expect(prepared.jobs.list()[0]).toMatchObject({
      pageTabId: 7,
      accountId: 11,
      content: 'snapshot v1',
      imagePaths: ['C:\\media\\one.jpg']
    })
    expect(prepared.wake).toHaveBeenCalledTimes(1)

    await prepared.service.save({
      pageTabId: 7,
      accountId: 11,
      enabled: true,
      content: 'source changed after concrete job',
      imagePaths: [],
      schedules: [prepared.window]
    })
    expect(await prepared.service.tick()).toBe(0)
    expect(prepared.jobs.list()).toHaveLength(1)
    expect(prepared.jobs.list()[0]?.content).toBe('snapshot v1')

    prepared.service.dispose()
    prepared.runtime.close()
  })

  it('creates a new occurrence on the next matching local date but never catches up after a missed window', async () => {
    const prepared = setup()
    await prepared.service.save({
      pageTabId: 7,
      accountId: 11,
      enabled: true,
      content: 'weekly',
      imagePaths: [],
      schedules: [prepared.window]
    })

    expect(await prepared.service.tick()).toBe(1)
    const nextWeek = new Date(prepared.now)
    nextWeek.setDate(nextWeek.getDate() + 7)
    prepared.setNow(nextWeek)
    expect(await prepared.service.tick()).toBe(1)
    expect(prepared.jobs.list()).toHaveLength(2)

    const afterWindow = new Date(nextWeek)
    afterWindow.setHours(12, 0, 0, 0)
    prepared.setNow(afterWindow)
    expect(await prepared.service.tick()).toBe(0)
    expect(prepared.jobs.list()).toHaveLength(2)

    prepared.service.dispose()
    prepared.runtime.close()
  })

  it('does not reserve an occurrence when materialization fails, so a later safe tick can recover', async () => {
    const prepared = setup()
    prepared.prepare.mockResolvedValueOnce({
      ok: true,
      prepared: {
        input: { accountId: 11, pageUid: '90001', content: 'save-check', imagePaths: [] },
        pageTabName: 'Page A', accountUid: '10001', accountName: null
      }
    })
    prepared.prepare.mockResolvedValueOnce({
      ok: false,
      result: {
        pageTabId: 7,
        accountId: 11,
        status: 'failed',
        code: 'media_failed',
        message: 'folder unavailable'
      }
    })
    prepared.prepare.mockResolvedValue({
      ok: true,
      prepared: {
        input: { accountId: 11, pageUid: '90001', content: 'recovered', imagePaths: [] },
        pageTabName: 'Page A', accountUid: '10001', accountName: null
      }
    })

    await prepared.service.save({
      pageTabId: 7,
      accountId: 11,
      enabled: true,
      content: 'source',
      imagePaths: [],
      schedules: [prepared.window]
    })
    expect(await prepared.service.tick()).toBe(0)
    expect(prepared.plans.get(7)?.lastError).toContain('folder unavailable')
    expect(prepared.jobs.list()).toHaveLength(0)

    expect(await prepared.service.tick()).toBe(1)
    expect(prepared.plans.get(7)?.lastError).toBeNull()
    expect(prepared.jobs.list()).toHaveLength(1)

    prepared.service.dispose()
    prepared.runtime.close()
  })
})
