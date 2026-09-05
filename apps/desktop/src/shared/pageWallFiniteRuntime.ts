import type { PageWallCanonicalPostSelection, PageWallRunNowResult } from './pageWall'
import type { PageWallJobRecord } from './pageWallJobs'
import type { PageWallPlanOccurrenceRecord, PageWallPlanRecord, SavePageWallPlanInput } from './pageWallPlans'

export const PAGE_WALL_FINITE_IPC = {
  dashboard: 'page-wall-finite:dashboard',
  runNow: 'page-wall-finite:run-now',
  savePlan: 'page-wall-finite:plans:save',
  deletePlan: 'page-wall-finite:plans:delete',
  saveSchedule: 'page-wall-finite:schedules:save',
  deleteSchedule: 'page-wall-finite:schedules:delete'
} as const

export interface PageWallFinitePagePayload { pageTabId: number }
export interface PageWallFinitePlanIdPayload { planId: number }
export interface PageWallFinitePlanIdsPayload { planIds: number[] }

export interface PageWallFiniteRunNowPayload {
  pageTabId: number
  accountIds: number[]
  accountConcurrency: number
  content: string
  imagePaths: string[]
  canonicalPost?: PageWallCanonicalPostSelection
}

export interface PageWallFiniteRunNowResult {
  accountConcurrency: number
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

export interface PageWallFinitePlanView extends PageWallPlanRecord {
  latestOccurrence: PageWallPlanOccurrenceRecord | null
}

export interface PageWallFiniteDashboard {
  plans: PageWallFinitePlanView[]
  jobs: PageWallJobRecord[]
}

export interface PageWallFiniteApi {
  getDashboard(payload: PageWallFinitePagePayload): Promise<PageWallFiniteDashboard>
  runNow(payload: PageWallFiniteRunNowPayload): Promise<PageWallFiniteRunNowResult>
  savePlan(payload: SavePageWallFinitePlanPayload): Promise<PageWallPlanRecord>
  deletePlan(payload: PageWallFinitePlanIdPayload): Promise<boolean>
  saveSchedule(payload: SavePageWallFiniteSchedulePayload): Promise<PageWallPlanRecord[]>
  deleteSchedule(payload: PageWallFinitePlanIdsPayload): Promise<number>
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

export function normalizePageWallScheduleMinutes(values: readonly number[]): number[] {
  const minutes = [...new Set(values
    .filter((value) => Number.isSafeInteger(value) && value >= 0 && value <= 1439)
    .map((value) => Math.floor(value)))]
    .sort((left, right) => left - right)
  if (minutes.length === 0) throw new Error('Lịch Đăng Tường cần ít nhất một giờ chạy.')
  if (minutes.length > 12) throw new Error('Một lịch Đăng Tường hỗ trợ tối đa 12 giờ chạy.')
  return minutes
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
