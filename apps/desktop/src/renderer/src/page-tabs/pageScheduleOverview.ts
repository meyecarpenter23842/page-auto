import type { PageTabSchedule, PageTabScheduleInput } from '../../../shared/pageTabs'
import { EVERY_DAY_SCHEDULE } from './scheduleEditor'

type ScheduleLike = Pick<PageTabScheduleInput, 'dayOfWeek' | 'startMinute' | 'endMinute' | 'enabled'>

function dayRank(day: number): number { return day === EVERY_DAY_SCHEDULE ? 0 : day === 0 ? 7 : day }

/** Presentation only; edit indexes and stored sortOrder are unchanged. */
export function sortScheduleEditorRows<T extends PageTabSchedule>(schedules: readonly T[]): Array<{ schedule: T; index: number }> {
  return schedules.map((schedule, index) => ({ schedule, index }))
    .sort((a, b) => dayRank(a.schedule.dayOfWeek) - dayRank(b.schedule.dayOfWeek)
      || a.schedule.startMinute - b.schedule.startMinute || a.index - b.index)
}

/** Next configured local-time window, not a promise that an automation run will start. */
export function nextSavedWindow(schedules: readonly ScheduleLike[], now: Date): Date | null {
  const valid = schedules.filter((s) => s.enabled
    && s.startMinute >= 0 && s.startMinute < 1440
    && s.endMinute > s.startMinute && s.endMinute <= 1440
    && (s.dayOfWeek === EVERY_DAY_SCHEDULE || (s.dayOfWeek >= 0 && s.dayOfWeek <= 6)))
  if (!valid.length) return null
  let best: Date | null = null
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    for (const schedule of valid) {
      if (schedule.dayOfWeek !== EVERY_DAY_SCHEDULE && schedule.dayOfWeek !== day.getDay()) continue
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(),
        Math.floor(schedule.startMinute / 60), schedule.startMinute % 60)
      if (start.getTime() <= now.getTime()) continue
      if (!best || start.getTime() < best.getTime()) best = start
    }
    if (best) break
  }
  return best
}

export function savedWindowCount(schedules: readonly ScheduleLike[]): number {
  return schedules.filter((s) => s.enabled && s.startMinute >= 0 && s.startMinute < s.endMinute && s.endMinute <= 1440).length
}
