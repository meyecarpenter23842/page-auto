import type { PageTabScheduleInput } from '../../shared/pageTabs'

export function enabledSchedules(schedules: PageTabScheduleInput[]): PageTabScheduleInput[] {
  return schedules.filter((schedule) => schedule.enabled)
}

function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

export function isWithinSchedule(schedules: PageTabScheduleInput[], now: Date): boolean {
  const enabled = enabledSchedules(schedules)
  if (enabled.length === 0) return true

  const minuteOfDay = now.getHours() * 60 + now.getMinutes()
  return enabled.some((schedule) =>
    schedule.dayOfWeek === now.getDay() &&
    minuteOfDay >= schedule.startMinute &&
    minuteOfDay < schedule.endMinute
  )
}

/**
 * Stable identity for the currently active schedule window. With no configured
 * schedules, the whole local day is treated as one window so a tab runs one
 * account cycle per day instead of looping forever.
 */
export function scheduleWindowKey(schedules: PageTabScheduleInput[], now: Date): string | null {
  const enabled = enabledSchedules(schedules)
  const dateKey = localDateKey(now)
  if (enabled.length === 0) return `${dateKey}:all-day`

  const minuteOfDay = now.getHours() * 60 + now.getMinutes()
  const active = enabled
    .filter((schedule) =>
      schedule.dayOfWeek === now.getDay() &&
      minuteOfDay >= schedule.startMinute &&
      minuteOfDay < schedule.endMinute
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.startMinute - b.startMinute || a.endMinute - b.endMinute)[0]

  if (!active) return null
  return `${dateKey}:${active.sortOrder}:${active.startMinute}-${active.endMinute}`
}

export function nextScheduleStart(schedules: PageTabScheduleInput[], now: Date): Date | null {
  const enabled = enabledSchedules(schedules)
  if (enabled.length === 0) return null

  let best: Date | null = null
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = new Date(now)
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() + offset)

    for (const schedule of enabled) {
      if (schedule.dayOfWeek !== day.getDay()) continue
      const candidate = new Date(day.getTime() + schedule.startMinute * 60_000)
      if (candidate.getTime() <= now.getTime()) continue
      if (!best || candidate.getTime() < best.getTime()) best = candidate
    }
  }
  return best
}

/** Next configured window, or next local midnight when the tab is all-day. */
export function nextScheduleWindowStart(schedules: PageTabScheduleInput[], now: Date): Date {
  const enabled = enabledSchedules(schedules)
  if (enabled.length === 0) {
    const nextDay = new Date(now)
    nextDay.setHours(0, 0, 0, 0)
    nextDay.setDate(nextDay.getDate() + 1)
    return nextDay
  }

  const next = nextScheduleStart(enabled, now)
  if (!next) throw new Error('Không tìm thấy khung giờ chạy kế tiếp trong lịch Page Tab.')
  return next
}

export function nextScheduleStartAfterDay(schedules: PageTabScheduleInput[], now: Date): Date {
  const enabled = enabledSchedules(schedules)
  if (enabled.length === 0) {
    const nextDay = new Date(now)
    nextDay.setHours(0, 0, 0, 0)
    nextDay.setDate(nextDay.getDate() + 1)
    return nextDay
  }

  const endOfDay = new Date(now)
  endOfDay.setHours(23, 59, 59, 999)
  const next = nextScheduleStart(enabled, endOfDay)
  if (!next) throw new Error('Không tìm thấy ngày chạy kế tiếp trong lịch Page Tab.')
  return next
}

export function randomDelaySeconds(minSeconds: number, maxSeconds: number, random = Math.random): number {
  const min = Math.max(0, Math.floor(minSeconds))
  const max = Math.max(min, Math.floor(maxSeconds))
  if (max === min) return min
  return min + Math.floor(random() * (max - min + 1))
}
