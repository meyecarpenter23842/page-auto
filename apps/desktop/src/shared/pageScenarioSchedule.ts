import type { ScenarioRunnerRuntimeSettings } from './scenarioRunnerRuntime'

export const PAGE_SCENARIO_SCHEDULE_IPC = {
  dashboard: 'page-scenario-schedule:dashboard',
  saveSchedule: 'page-scenario-schedule:save',
  deleteSchedule: 'page-scenario-schedule:delete',
  setScheduleEnabled: 'page-scenario-schedule:set-enabled'
} as const

export const PAGE_SCENARIO_PLAN_STATUSES = ['active', 'completed', 'disabled', 'needs_attention'] as const
export type PageScenarioPlanStatus = typeof PAGE_SCENARIO_PLAN_STATUSES[number]
export type PageScenarioScheduleKind = 'specific_date' | 'daily'
export type PageScenarioOccurrenceStatus = 'pending' | 'running' | 'success' | 'failed' | 'needs_attention' | 'cancelled'

export interface PageScenarioPlanRecord {
  id: number
  pageTabId: number
  scheduleKind: PageScenarioScheduleKind
  localDate: string | null
  minuteOfDay: number
  accountConcurrency: number
  accountIds: number[]
  scenarioId: number
  status: PageScenarioPlanStatus
  lastError: string | null
  createdAt: number
  updatedAt: number
}

export interface PageScenarioOccurrenceRecord {
  id: number
  planId: number
  occurrenceKey: string
  localDate: string
  scheduledAt: number
  status: PageScenarioOccurrenceStatus
  pageUid: string
  accountConcurrency: number
  accountIds: number[]
  scenarioId: number
  runnerRunId: string | null
  resultMessage: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  updatedAt: number
}

export interface PageScenarioPlanView extends PageScenarioPlanRecord {
  latestOccurrence: PageScenarioOccurrenceRecord | null
}

export interface PageScenarioScheduleDashboard {
  plans: PageScenarioPlanView[]
}

export interface SavePageScenarioPlanInput {
  pageTabId: number
  scheduleKind: PageScenarioScheduleKind
  localDate: string | null
  minuteOfDay: number
  accountConcurrency: number
  accountIds: number[]
  scenarioId: number
  enabled: boolean
}

export interface SavePageScenarioSchedulePayload {
  planIds?: number[]
  input: Omit<SavePageScenarioPlanInput, 'minuteOfDay'> & { minuteOfDays: number[] }
}

export interface PageScenarioPagePayload { pageTabId: number }
export interface PageScenarioPlanIdsPayload { planIds: number[] }
export interface SetPageScenarioScheduleEnabledPayload extends PageScenarioPlanIdsPayload { pageTabId: number; enabled: boolean }

export interface PageScenarioScheduleApi {
  getDashboard(payload: PageScenarioPagePayload): Promise<PageScenarioScheduleDashboard>
  saveSchedule(payload: SavePageScenarioSchedulePayload): Promise<PageScenarioPlanRecord[]>
  deleteSchedule(payload: PageScenarioPlanIdsPayload): Promise<boolean>
  setScheduleEnabled(payload: SetPageScenarioScheduleEnabledPayload): Promise<PageScenarioPlanRecord[]>
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} không hợp lệ.`)
  return value
}

export function positiveUniqueScenarioIds(values: readonly number[]): number[] {
  const seen = new Set<number>()
  const output: number[] = []
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value <= 0 || seen.has(value)) continue
    seen.add(value)
    output.push(value)
  }
  return output
}

export function normalizePageScenarioLocalDate(value: string | null | undefined): string {
  const normalized = value?.trim() ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error('Ngày chạy không hợp lệ.')
  return normalized
}

export function normalizePageScenarioScheduleMinutes(values: readonly number[]): number[] {
  if (!values.length) throw new Error('Hãy thêm ít nhất một giờ chạy.')
  const seen = new Set<number>()
  const output: number[] = []
  for (const raw of values) {
    const minute = Number(raw)
    if (!Number.isSafeInteger(minute) || minute < 0 || minute > 1439) throw new Error('Giờ chạy không hợp lệ.')
    if (seen.has(minute)) throw new Error('Các giờ chạy không được trùng nhau.')
    seen.add(minute)
    output.push(minute)
  }
  return output.sort((left, right) => left - right)
}

export function normalizePageScenarioPlanInput(input: SavePageScenarioPlanInput): SavePageScenarioPlanInput {
  const pageTabId = positiveInteger(input.pageTabId, 'Page')
  const scenarioId = positiveInteger(input.scenarioId, 'Kịch bản')
  const accountIds = positiveUniqueScenarioIds(input.accountIds)
  if (!accountIds.length) throw new Error('Hãy chọn ít nhất một tài khoản.')
  const accountConcurrency = Math.max(1, Math.min(20, Math.floor(Number(input.accountConcurrency) || 1)))
  const minuteOfDay = Number(input.minuteOfDay)
  if (!Number.isSafeInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay > 1439) throw new Error('Giờ chạy không hợp lệ.')
  if (input.scheduleKind !== 'specific_date' && input.scheduleKind !== 'daily') throw new Error('Kiểu lịch chạy không hợp lệ.')
  const localDate = input.scheduleKind === 'specific_date' ? normalizePageScenarioLocalDate(input.localDate) : null
  return { pageTabId, scheduleKind: input.scheduleKind, localDate, minuteOfDay, accountConcurrency, accountIds, scenarioId, enabled: Boolean(input.enabled) }
}

export function pageScenarioOccurrenceKey(localDate: string): string {
  return normalizePageScenarioLocalDate(localDate)
}

export function createPageScenarioRunnerSettings(accountConcurrency: number): ScenarioRunnerRuntimeSettings {
  return {
    randomScenarios: false,
    randomScenarioCount: 1,
    secondaryProfile: false,
    secondaryProfileCount: 1,
    parallelAccounts: Math.max(1, Math.min(20, Math.floor(accountConcurrency || 1))),
    actionDelayMinSeconds: 5,
    actionDelayMaxSeconds: 10,
    accountSwitchDelayMinSeconds: 5,
    accountSwitchDelayMaxSeconds: 10,
    pauseAfterActions: 100,
    pauseMinutes: 30,
    pauseOnErrorMinutes: 60,
    repeat: false,
    repeatCount: 1,
    pauseAfterAccounts: 999,
    pauseAfterAccountsMinutes: 30,
    proxyResetEnabled: false,
    proxyThreadsPerProxy: 4,
    dcomResetEnabled: false,
    dcomEveryAccounts: 1,
    startIndex: 0,
    limitPerAccount: 1000
  }
}

export interface PageScenarioScheduleRuntimeState {
  label: string
  tone: 'idle' | 'running' | 'success' | 'failed' | 'needs_attention' | 'disabled'
}

export function pageScenarioScheduleRuntimeState(plans: readonly PageScenarioPlanView[], today: string): PageScenarioScheduleRuntimeState {
  if (!plans.length) return { label: 'Chờ lịch', tone: 'idle' }
  if (plans.some((plan) => plan.latestOccurrence?.status === 'running' || plan.latestOccurrence?.status === 'pending')) {
    return { label: 'Đang chạy', tone: 'running' }
  }
  if (plans.some((plan) => plan.status === 'needs_attention' || plan.latestOccurrence?.status === 'needs_attention')) {
    return { label: 'Cần xử lý', tone: 'needs_attention' }
  }
  if (plans.some((plan) => plan.latestOccurrence?.status === 'failed')) return { label: 'Lỗi lượt gần nhất', tone: 'failed' }
  if (plans.every((plan) => plan.status === 'disabled')) return { label: 'Tạm dừng', tone: 'disabled' }
  if (plans.every((plan) => plan.status === 'completed')) return { label: 'Hoàn tất', tone: 'success' }
  if (plans.some((plan) => plan.scheduleKind === 'daily' && plan.latestOccurrence?.localDate === today && plan.latestOccurrence.status === 'success')) {
    return { label: 'Đã chạy hôm nay', tone: 'success' }
  }
  return { label: 'Chờ lịch', tone: 'idle' }
}
