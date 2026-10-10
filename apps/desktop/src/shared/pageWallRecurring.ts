import type { PageWallCanonicalPostSelection } from './pageWall'

export interface PageWallRecurringScheduleWindow {
  dayOfWeek: number
  startMinute: number
  endMinute: number
  enabled: boolean
  sortOrder: number
}

export interface PageWallRecurringPlanSource {
  content: string
  imagePaths: string[]
  canonicalPost?: PageWallCanonicalPostSelection
}

export interface SavePageWallRecurringPlanInput extends PageWallRecurringPlanSource {
  pageTabId: number
  accountId: number
  enabled: boolean
  schedules: PageWallRecurringScheduleWindow[]
}

export interface PageWallRecurringPlanRecord extends SavePageWallRecurringPlanInput {
  id: number
  lastError: string | null
  createdAt: number
  updatedAt: number
}

export interface PageWallRecurringPagePayload {
  pageTabId: number
}

function assertIntegerRange(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} không hợp lệ.`)
  }
  return value
}

export function normalizePageWallRecurringSchedules(
  schedules: PageWallRecurringScheduleWindow[]
): PageWallRecurringScheduleWindow[] {
  if (!Array.isArray(schedules) || schedules.length === 0) {
    throw new Error('Lịch chạy cần ít nhất một khung giờ.')
  }
  if (schedules.length > 128) throw new Error('Lịch chạy có quá nhiều khung giờ.')

  const normalized = schedules.map((schedule, index) => ({
    dayOfWeek: assertIntegerRange(schedule.dayOfWeek, 0, 6, 'Ngày chạy'),
    startMinute: assertIntegerRange(schedule.startMinute, 0, 1439, 'Giờ bắt đầu'),
    endMinute: assertIntegerRange(schedule.endMinute, 1, 1440, 'Giờ kết thúc'),
    enabled: schedule.enabled !== false,
    sortOrder: Number.isInteger(schedule.sortOrder) && schedule.sortOrder >= 0
      ? schedule.sortOrder
      : index
  })).sort((a, b) =>
    a.sortOrder - b.sortOrder
    || a.dayOfWeek - b.dayOfWeek
    || a.startMinute - b.startMinute
    || a.endMinute - b.endMinute
  ).map((schedule, sortOrder) => ({ ...schedule, sortOrder }))

  for (const schedule of normalized) {
    if (schedule.endMinute <= schedule.startMinute) {
      throw new Error('Giờ kết thúc phải lớn hơn giờ bắt đầu trong cùng ngày.')
    }
  }

  for (let day = 0; day <= 6; day += 1) {
    const active = normalized
      .filter((schedule) => schedule.enabled && schedule.dayOfWeek === day)
      .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute)
    for (let index = 1; index < active.length; index += 1) {
      const current = active[index]
      const previous = active[index - 1]
      if (current && previous && current.startMinute < previous.endMinute) {
        throw new Error('Các khung giờ đang bật trong cùng ngày không được chồng lên nhau.')
      }
    }
  }

  return normalized
}

export function activePageWallRecurringWindow(
  schedules: PageWallRecurringScheduleWindow[],
  now: Date
): PageWallRecurringScheduleWindow | null {
  const minuteOfDay = now.getHours() * 60 + now.getMinutes()
  return schedules
    .filter((schedule) =>
      schedule.enabled
      && schedule.dayOfWeek === now.getDay()
      && minuteOfDay >= schedule.startMinute
      && minuteOfDay < schedule.endMinute
    )
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute || a.sortOrder - b.sortOrder)[0]
    ?? null
}

function localDateKey(now: Date): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-')
}

export function pageWallRecurringOccurrenceKey(
  window: PageWallRecurringScheduleWindow,
  now: Date
): string {
  return `${localDateKey(now)}:${window.dayOfWeek}:${window.startMinute}-${window.endMinute}`
}
