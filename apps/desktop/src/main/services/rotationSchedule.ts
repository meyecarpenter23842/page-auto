import type { PageTabScheduleInput } from '../../shared/pageTabs'

export function enabledSchedules(schedules: PageTabScheduleInput[]): PageTabScheduleInput[] {
  return schedules.filter((schedule) => schedule.enabled)
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
