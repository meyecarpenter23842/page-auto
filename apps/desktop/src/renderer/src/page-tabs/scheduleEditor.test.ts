import { describe, expect, it } from 'vitest'
import type { PageTabSchedule } from '../../../shared/pageTabs'
import { collapseEveryDaySchedules, EVERY_DAY_SCHEDULE, expandEveryDaySchedules } from './scheduleEditor'

function schedule(id: number, dayOfWeek: number, startMinute = 480, endMinute = 660): PageTabSchedule {
  return { id, dayOfWeek, startMinute, endMinute, enabled: true, sortOrder: id - 1 }
}

describe('scheduleEditor', () => {
  it('expands one Mỗi ngày row into seven persisted weekdays', () => {
    const rows = [schedule(1, EVERY_DAY_SCHEDULE)]
    const expanded = expandEveryDaySchedules(rows)

    expect(expanded).toHaveLength(7)
    expect(expanded.map((item) => item.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(expanded.every((item) => item.startMinute === 480 && item.endMinute === 660 && item.enabled)).toBe(true)
    expect(expanded.map((item) => item.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('collapses seven identical weekdays back into one Mỗi ngày row', () => {
    const rows = Array.from({ length: 7 }, (_, day) => schedule(day + 1, day))
    const collapsed = collapseEveryDaySchedules(rows)

    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]?.dayOfWeek).toBe(EVERY_DAY_SCHEDULE)
    expect(collapsed[0]?.startMinute).toBe(480)
    expect(collapsed[0]?.endMinute).toBe(660)
  })

  it('does not collapse an incomplete set of weekdays', () => {
    const rows = Array.from({ length: 6 }, (_, day) => schedule(day + 1, day))
    expect(collapseEveryDaySchedules(rows).map((item) => item.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5])
  })
})
