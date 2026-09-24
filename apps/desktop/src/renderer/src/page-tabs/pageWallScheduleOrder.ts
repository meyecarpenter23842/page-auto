export interface PageWallScheduleOrderLike {
  scheduleKind: 'specific_date' | 'daily'
  localDate: string | null
  weekdays: number[]
  minutes: number[]
  planIds: number[]
}

function weekdayRank(day: number): number {
  if (day === 0) return 6
  if (day >= 1 && day <= 6) return day - 1
  return 7
}

function firstWeekdayRank(weekdays: number[]): number {
  return weekdays.reduce((best, day) => Math.min(best, weekdayRank(day)), 7)
}

function firstMinute(minutes: number[]): number {
  return minutes.length ? Math.min(...minutes) : Number.MAX_SAFE_INTEGER
}

function firstPlanId(planIds: number[]): number {
  return planIds.length ? Math.min(...planIds) : Number.MAX_SAFE_INTEGER
}

export function comparePageWallScheduleGroups(
  left: PageWallScheduleOrderLike,
  right: PageWallScheduleOrderLike
): number {
  if (left.scheduleKind !== right.scheduleKind) {
    return left.scheduleKind === 'specific_date' ? -1 : 1
  }

  const minuteDelta = firstMinute(left.minutes) - firstMinute(right.minutes)
  const idDelta = firstPlanId(left.planIds) - firstPlanId(right.planIds)

  if (left.scheduleKind === 'specific_date') {
    return (left.localDate ?? '').localeCompare(right.localDate ?? '') || minuteDelta || idDelta
  }

  return firstWeekdayRank(left.weekdays) - firstWeekdayRank(right.weekdays) || minuteDelta || idDelta
}
