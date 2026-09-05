import { describe, expect, it } from 'vitest'
import type { PageWallPlanOccurrenceRecord } from './pageWallPlans'
import {
  PAGE_WALL_PUBLISH_UNCONFIRMED_LABEL,
  buildPageWallFiniteTasks,
  canEditPageWallFiniteSchedule,
  normalizePageWallImmediateDelaySeconds,
  normalizePageWallScheduleMinutes,
  pageWallFiniteScheduleRuntimeState,
  summarizePageWallFiniteOccurrenceJobs,
  type PageWallFinitePlanView
} from './pageWallFiniteRuntime'

function occurrence(
  status: PageWallPlanOccurrenceRecord['status'],
  localDate = '2026-09-05',
  resultMessage: string | null = null
): PageWallPlanOccurrenceRecord {
  return {
    id: 10,
    planId: 1,
    occurrenceKey: localDate,
    localDate,
    scheduledAt: 1,
    status,
    accountConcurrency: 1,
    taskCount: 1,
    resultMessage,
    createdAt: 1,
    startedAt: status === 'pending' ? null : 1,
    finishedAt: ['success', 'failed', 'needs_attention', 'cancelled'].includes(status) ? 2 : null,
    updatedAt: 2
  }
}

function plan(patch: Partial<PageWallFinitePlanView> = {}): PageWallFinitePlanView {
  return {
    id: 1,
    pageTabId: 7,
    scheduleKind: 'daily',
    localDate: null,
    minuteOfDay: 480,
    accountConcurrency: 1,
    tasks: [{ accountId: 11, source: { kind: 'canonical', postId: 7, variantIndex: 0 }, sortOrder: 0 }],
    taskCount: 1,
    status: 'active',
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
    latestOccurrence: null,
    ...patch
  }
}

describe('Page Wall finite task mapping', () => {
  it('materializes an explicit finite round-robin mapping at save time', () => {
    expect(buildPageWallFiniteTasks({
      accountIds: [11, 22],
      taskCount: 5,
      source: { kind: 'canonical', postId: 7, variantIndex: 0 }
    })).toEqual([
      { accountId: 11, source: { kind: 'canonical', postId: 7, variantIndex: 0 }, sortOrder: 0 },
      { accountId: 22, source: { kind: 'canonical', postId: 7, variantIndex: 0 }, sortOrder: 1 },
      { accountId: 11, source: { kind: 'canonical', postId: 7, variantIndex: 0 }, sortOrder: 2 },
      { accountId: 22, source: { kind: 'canonical', postId: 7, variantIndex: 0 }, sortOrder: 3 },
      { accountId: 11, source: { kind: 'canonical', postId: 7, variantIndex: 0 }, sortOrder: 4 }
    ])
  })

  it('rejects an empty selection instead of inventing an account', () => {
    expect(() => buildPageWallFiniteTasks({ accountIds: [], taskCount: 1, source: { kind: 'manual', content: 'A', imagePaths: [] } })).toThrow('ít nhất một tài khoản')
  })
})

describe('Page Wall immediate-run delay', () => {
  it('accepts an explicit 0..3600 second spacing', () => {
    expect(normalizePageWallImmediateDelaySeconds(undefined)).toBe(0)
    expect(normalizePageWallImmediateDelaySeconds(0)).toBe(0)
    expect(normalizePageWallImmediateDelaySeconds(45)).toBe(45)
    expect(normalizePageWallImmediateDelaySeconds(3600)).toBe(3600)
  })

  it('rejects invalid delay instead of silently changing the operator setting', () => {
    expect(() => normalizePageWallImmediateDelaySeconds(-1)).toThrow('0 đến 3600')
    expect(() => normalizePageWallImmediateDelaySeconds(1.5)).toThrow('0 đến 3600')
    expect(() => normalizePageWallImmediateDelaySeconds(3601)).toThrow('0 đến 3600')
  })
})

describe('Page Wall FPlus-style multi-time schedule', () => {
  it('deduplicates and sorts finite plan slots for one visible schedule', () => {
    expect(normalizePageWallScheduleMinutes([1200, 480, 1200, 750])).toEqual([480, 750, 1200])
  })

  it('rejects an empty or oversized time list', () => {
    expect(() => normalizePageWallScheduleMinutes([])).toThrow('ít nhất một giờ chạy')
    expect(() => normalizePageWallScheduleMinutes(Array.from({ length: 13 }, (_value, index) => index * 30))).toThrow('tối đa 12 giờ')
  })
})

describe('Page Wall finite occurrence outcome semantics', () => {
  it('maps publish_unconfirmed to needs_attention without claiming publish success', () => {
    const summary = summarizePageWallFiniteOccurrenceJobs([{
      status: 'failed',
      resultStatus: 'failed',
      resultCode: 'publish_unconfirmed'
    }])

    expect(summary.status).toBe('needs_attention')
    expect(summary.needsAttention).toBe(true)
    expect(summary.successCount).toBe(0)
    expect(summary.publishUnconfirmedCount).toBe(1)
    expect(summary.message).toContain(PAGE_WALL_PUBLISH_UNCONFIRMED_LABEL)
    expect(summary.message).toContain('Không tự retry')
  })

  it('keeps a genuine publish failure as failed', () => {
    expect(summarizePageWallFiniteOccurrenceJobs([{
      status: 'failed',
      resultStatus: 'failed',
      resultCode: 'publish_action_failed'
    }])).toMatchObject({
      status: 'failed',
      needsAttention: false,
      publishUnconfirmedCount: 0
    })
  })

  it('keeps login/checkpoint outcomes in needs_attention', () => {
    expect(summarizePageWallFiniteOccurrenceJobs([{
      status: 'failed',
      resultStatus: 'needs_login',
      resultCode: 'verification_required'
    }])).toMatchObject({
      status: 'needs_attention',
      needsAttention: true,
      publishUnconfirmedCount: 0
    })
  })
})

describe('Page Wall schedule runtime view', () => {
  it('shows a successful daily occurrence as completed today while keeping the plan active for tomorrow', () => {
    const state = pageWallFiniteScheduleRuntimeState([
      plan({ status: 'active', latestOccurrence: occurrence('success') })
    ], '2026-09-05')

    expect(state).toEqual({ label: 'Đã chạy hôm nay · chờ ngày mai', tone: 'completed' })
  })

  it('shows partial progress for a multi-time daily schedule', () => {
    const state = pageWallFiniteScheduleRuntimeState([
      plan({ id: 1, latestOccurrence: occurrence('success') }),
      plan({ id: 2, minuteOfDay: 720, latestOccurrence: null })
    ], '2026-09-05')

    expect(state).toEqual({ label: 'Đã chạy 1/2 hôm nay', tone: 'completed' })
  })

  it('shows publish uncertainty as attention instead of latest-run failure', () => {
    const state = pageWallFiniteScheduleRuntimeState([
      plan({
        status: 'needs_attention',
        latestOccurrence: occurrence(
          'needs_attention',
          '2026-09-05',
          `${PAGE_WALL_PUBLISH_UNCONFIRMED_LABEL}: 1/1 task chưa có evidence đủ chắc.`
        )
      })
    ], '2026-09-05')

    expect(state).toEqual({ label: PAGE_WALL_PUBLISH_UNCONFIRMED_LABEL, tone: 'needs_attention' })
  })

  it('allows editing historical success but blocks editing while an occurrence is pending/running', () => {
    expect(canEditPageWallFiniteSchedule([plan({ latestOccurrence: occurrence('success') })])).toBe(true)
    expect(canEditPageWallFiniteSchedule([plan({ latestOccurrence: occurrence('running') })])).toBe(false)
    expect(canEditPageWallFiniteSchedule([plan({ latestOccurrence: occurrence('pending') })])).toBe(false)
  })

  it('shows an explicitly paused schedule as paused even if it has older history', () => {
    const state = pageWallFiniteScheduleRuntimeState([
      plan({ status: 'disabled', latestOccurrence: occurrence('success', '2026-09-04') })
    ], '2026-09-05')
    expect(state).toEqual({ label: 'Tạm dừng', tone: 'disabled' })
  })
})
