import type { PageTabSchedule, PageTabScheduleInput } from '../../../shared/pageTabs'

export const EVERY_DAY_SCHEDULE = -1

function scheduleSignature(schedule: Pick<PageTabScheduleInput, 'enabled' | 'startMinute' | 'endMinute'>): string {
  return `${schedule.enabled ? 1 : 0}:${schedule.startMinute}:${schedule.endMinute}`
}

export function collapseEveryDaySchedules(schedules: PageTabSchedule[]): PageTabSchedule[] {
  const grouped = new Map<string, PageTabSchedule[]>()
  for (const schedule of schedules) {
    const key = scheduleSignature(schedule)
    const items = grouped.get(key) ?? []
    items.push(schedule)
    grouped.set(key, items)
  }

  const collapsed: PageTabSchedule[] = []
  for (const items of grouped.values()) {
    const byDay = new Map<number, PageTabSchedule>()
    for (const item of items) {
      if (item.dayOfWeek >= 0 && item.dayOfWeek <= 6 && !byDay.has(item.dayOfWeek)) byDay.set(item.dayOfWeek, item)
    }

    if (byDay.size === 7) {
      const representative = [...byDay.values()].sort((a, b) => a.sortOrder - b.sortOrder)[0]
      if (representative) collapsed.push({ ...representative, dayOfWeek: EVERY_DAY_SCHEDULE })
      const consumedIds = new Set([...byDay.values()].map((item) => item.id))
      collapsed.push(...items.filter((item) => !consumedIds.has(item.id)))
    } else {
      collapsed.push(...items)
    }
  }

  return collapsed
    .sort((a, b) => a.sortOrder - b.sortOrder || a.startMinute - b.startMinute || a.dayOfWeek - b.dayOfWeek)
    .map((item, index) => ({ ...item, sortOrder: index }))
}

export function expandEveryDaySchedules(schedules: PageTabSchedule[]): PageTabScheduleInput[] {
  const expanded: PageTabScheduleInput[] = []
  for (const schedule of schedules) {
    const days = schedule.dayOfWeek === EVERY_DAY_SCHEDULE ? [0, 1, 2, 3, 4, 5, 6] : [schedule.dayOfWeek]
    for (const dayOfWeek of days) {
      expanded.push({
        dayOfWeek,
        startMinute: schedule.startMinute,
        endMinute: schedule.endMinute,
        enabled: schedule.enabled,
        sortOrder: expanded.length
      })
    }
  }
  return expanded
}
