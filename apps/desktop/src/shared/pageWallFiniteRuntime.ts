import type { PageWallCanonicalPostSelection, PageWallRunNowResult } from './pageWall'
import type { PageWallJobRecord } from './pageWallJobs'
import type { PageWallPlanOccurrenceRecord, PageWallPlanRecord, SavePageWallPlanInput } from './pageWallPlans'

export const PAGE_WALL_FINITE_IPC = {
  dashboard: 'page-wall-finite:dashboard',
  runNow: 'page-wall-finite:run-now',
  savePlan: 'page-wall-finite:plans:save',
  deletePlan: 'page-wall-finite:plans:delete',
  saveSchedule: 'page-wall-finite:schedules:save',
  deleteSchedule: 'page-wall-finite:schedules:delete',
  setScheduleEnabled: 'page-wall-finite:schedules:set-enabled'
} as const

export interface PageWallFinitePagePayload { pageTabId: number }
export interface PageWallFinitePlanIdPayload { planId: number }
export interface PageWallFinitePlanIdsPayload { planIds: number[] }

export interface PageWallFiniteRunNowPayload {
  pageTabId: number
  accountIds: number[]
  accountConcurrency: number
  /** Additional Wall-only spacing between immediate-run starts. The first account starts immediately. */
  delayBetweenRunsSec?: number
  content: string
  imagePaths: string[]
  canonicalPost?: PageWallCanonicalPostSelection
}

export interface PageWallFiniteRunNowResult {
  accountConcurrency: number
  delayBetweenRunsSec: number
  requestedAccountIds: number[]
  results: PageWallRunNowResult[]
}

export interface SavePageWallFinitePlanPayload {
  planId?: number
  input: SavePageWallPlanInput
}

export interface SavePageWallFiniteScheduleInput extends Omit<SavePageWallPlanInput, 'minuteOfDay'> {
  /** One finite plan-slot is persisted per minute. UI presents the slots as one schedule. */
  minuteOfDays: number[]
}

export interface SavePageWallFiniteSchedulePayload {
  /** Existing slot ids when editing. Missing/excess ids are created/deleted atomically. */
  planIds?: number[]
  input: SavePageWallFiniteScheduleInput
}

export interface SetPageWallFiniteScheduleEnabledPayload {
  pageTabId: number
  planIds: number[]
  enabled: boolean
}

export interface PageWallFinitePlanView extends PageWallPlanRecord {
  latestOccurrence: PageWallPlanOccurrenceRecord | null
}

export interface PageWallFiniteDashboard {
  plans: PageWallFinitePlanView[]
  jobs: PageWallJobRecord[]
}

export type PageWallFiniteRuntimeTone = 'active' | 'running' | 'completed' | 'disabled' | 'needs_attention' | 'failed'
export interface PageWallFiniteRuntimeState {
  label: string
  tone: PageWallFiniteRuntimeTone
}

export interface PageWallFiniteApi {
  getDashboard(payload: PageWallFinitePagePayload): Promise<PageWallFiniteDashboard>
  runNow(payload: PageWallFiniteRunNowPayload): Promise<PageWallFiniteRunNowResult>
  savePlan(payload: SavePageWallFinitePlanPayload): Promise<PageWallPlanRecord>
  deletePlan(payload: PageWallFinitePlanIdPayload): Promise<boolean>
  saveSchedule(payload: SavePageWallFiniteSchedulePayload): Promise<PageWallPlanRecord[]>
  deleteSchedule(payload: PageWallFinitePlanIdsPayload): Promise<number>
  setScheduleEnabled(payload: SetPageWallFiniteScheduleEnabledPayload): Promise<PageWallPlanRecord[]>
}

function positiveIds(values: number[]): number[] {
  const seen = new Set<number>()
  const result: number[] = []
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value <= 0 || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

export function normalizePageWallImmediateDelaySeconds(value: number | undefined): number {
  const normalized = value ?? 0
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 3600) {
    throw new Error('Delay giữa lượt Đăng ngay phải từ 0 đến 3600 giây.')
  }
  return normalized
}

export function normalizePageWallScheduleMinutes(values: readonly number[]): number[] {
  const minutes = [...new Set(values
    .filter((value) => Number.isSafeInteger(value) && value >= 0 && value <= 1439)
    .map((value) => Math.floor(value)))]
    .sort((left, right) => left - right)
  if (minutes.length === 0) throw new Error('Lịch Đăng Tường cần ít nhất một giờ chạy.')
  if (minutes.length > 12) throw new Error('Một lịch Đăng Tường hỗ trợ tối đa 12 giờ chạy.')
  return minutes
}

export function canEditPageWallFiniteSchedule(plans: readonly PageWallFinitePlanView[]): boolean {
  return plans.length > 0 && plans.every((plan) => {
    const status = plan.latestOccurrence?.status
    return status !== 'pending' && status !== 'running'
  })
}

export function pageWallFiniteScheduleRuntimeState(
  plans: readonly PageWallFinitePlanView[],
  todayLocalDate: string
): PageWallFiniteRuntimeState {
  if (plans.length === 0) return { label: 'Đang chờ', tone: 'active' }

  const occurrences = plans.map((plan) => plan.latestOccurrence).filter((value): value is PageWallPlanOccurrenceRecord => Boolean(value))
  if (occurrences.some((occurrence) => occurrence.status === 'running' || occurrence.status === 'pending')) {
    return { label: 'Đang chạy', tone: 'running' }
  }

  const hasActiveFuture = plans.some((plan) => plan.status === 'active' || plan.status === 'needs_attention')
  if (!hasActiveFuture && plans.some((plan) => plan.status === 'disabled')) {
    return { label: 'Tạm dừng', tone: 'disabled' }
  }
  if (occurrences.some((occurrence) => occurrence.status === 'needs_attention') || plans.some((plan) => plan.status === 'needs_attention')) {
    return { label: 'Cần xử lý', tone: 'needs_attention' }
  }
  if (occurrences.some((occurrence) => occurrence.status === 'failed')) {
    return { label: 'Lỗi lượt gần nhất', tone: 'failed' }
  }

  if (plans[0]?.scheduleKind === 'daily') {
    const successToday = plans.filter((plan) => (
      plan.latestOccurrence?.localDate === todayLocalDate
      && plan.latestOccurrence.status === 'success'
    )).length
    if (successToday === plans.length && successToday > 0) {
      return { label: 'Đã chạy hôm nay · chờ ngày mai', tone: 'completed' }
    }
    if (successToday > 0) {
      return { label: `Đã chạy ${successToday}/${plans.length} hôm nay`, tone: 'completed' }
    }
  }

  if (plans.every((plan) => plan.status === 'completed' || plan.latestOccurrence?.status === 'success')) {
    return { label: 'Đã chạy', tone: 'completed' }
  }
  if (plans.some((plan) => plan.status === 'disabled')) {
    return { label: 'Tạm dừng', tone: 'disabled' }
  }
  return { label: 'Đang chờ', tone: 'active' }
}

export function buildPageWallFiniteTasks(input: {
  accountIds: number[]
  taskCount: number
  source: SavePageWallPlanInput['tasks'][number]['source']
}): SavePageWallPlanInput['tasks'] {
  const accountIds = positiveIds(input.accountIds)
  if (accountIds.length === 0) throw new Error('Kế hoạch Đăng Tường cần ít nhất một tài khoản.')
  if (!Number.isSafeInteger(input.taskCount) || input.taskCount < 1 || input.taskCount > 1_000) {
    throw new Error('Số task Đăng Tường phải từ 1 đến 1000.')
  }
  return Array.from({ length: input.taskCount }, (_unused, sortOrder) => ({
    accountId: accountIds[sortOrder % accountIds.length]!,
    source: input.source.kind === 'canonical'
      ? { ...input.source }
      : { ...input.source, imagePaths: [...input.source.imagePaths] },
    sortOrder
  }))
}
