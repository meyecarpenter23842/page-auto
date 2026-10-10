import { describe, expect, it } from 'vitest'
import {
  createPageScenarioRunnerSettings,
  normalizePageScenarioPlanInput,
  normalizePageScenarioScheduleMinutes,
  pageScenarioScheduleRuntimeState,
  type PageScenarioPlanView
} from './pageScenarioSchedule'

function plan(patch: Partial<PageScenarioPlanView> = {}): PageScenarioPlanView {
  return {
    id: 1,
    pageTabId: 7,
    scheduleKind: 'daily',
    localDate: null,
    minuteOfDay: 480,
    accountConcurrency: 1,
    accountIds: [11],
    scenarioId: 5,
    status: 'active',
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
    latestOccurrence: null,
    ...patch
  }
}

describe('pageScenarioSchedule', () => {
  it('normalizes a finite list of unique schedule minutes', () => {
    expect(normalizePageScenarioScheduleMinutes([720, 480])).toEqual([480, 720])
    expect(() => normalizePageScenarioScheduleMinutes([480, 480])).toThrow('không được trùng')
    expect(() => normalizePageScenarioScheduleMinutes([])).toThrow('ít nhất một giờ')
  })

  it('keeps canonical account ids unique and clears localDate for daily plans', () => {
    expect(normalizePageScenarioPlanInput({
      pageTabId: 7,
      scheduleKind: 'daily',
      localDate: '2026-09-05',
      minuteOfDay: 480,
      accountConcurrency: 40,
      accountIds: [11, 11, 12],
      scenarioId: 5,
      enabled: true
    })).toEqual({
      pageTabId: 7,
      scheduleKind: 'daily',
      localDate: null,
      minuteOfDay: 480,
      accountConcurrency: 20,
      accountIds: [11, 12],
      scenarioId: 5,
      enabled: true
    })
  })

  it('maps Page schedule concurrency into the shared Scenario runner settings', () => {
    const settings = createPageScenarioRunnerSettings(3)
    expect(settings.parallelAccounts).toBe(3)
    expect(settings.secondaryProfile).toBe(false)
    expect(settings.proxyResetEnabled).toBe(false)
    expect(settings.dcomResetEnabled).toBe(false)
  })

  it('shows attention before generic failure and never invents a retry state', () => {
    expect(pageScenarioScheduleRuntimeState([
      plan({ status: 'needs_attention', latestOccurrence: {
        id: 9,
        planId: 1,
        occurrenceKey: '2026-09-05',
        localDate: '2026-09-05',
        scheduledAt: 1,
        status: 'needs_attention',
        pageUid: '123',
        accountConcurrency: 1,
        accountIds: [11],
        scenarioId: 5,
        runnerRunId: 'run-1',
        resultMessage: 'Cần xác minh',
        createdAt: 1,
        startedAt: 1,
        finishedAt: 2,
        updatedAt: 2
      } })
    ], '2026-09-05')).toEqual({ label: 'Cần xử lý', tone: 'needs_attention' })
  })

  it('shows daily success for the current day', () => {
    expect(pageScenarioScheduleRuntimeState([
      plan({ latestOccurrence: {
        id: 9,
        planId: 1,
        occurrenceKey: '2026-09-05',
        localDate: '2026-09-05',
        scheduledAt: 1,
        status: 'success',
        pageUid: '123',
        accountConcurrency: 1,
        accountIds: [11],
        scenarioId: 5,
        runnerRunId: 'run-1',
        resultMessage: 'Hoàn tất',
        createdAt: 1,
        startedAt: 1,
        finishedAt: 2,
        updatedAt: 2
      } })
    ], '2026-09-05')).toEqual({ label: 'Đã chạy hôm nay', tone: 'success' })
  })
})
