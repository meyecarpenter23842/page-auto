import { describe, expect, it } from 'vitest'
import type { PageTabSchedule } from '../../../shared/pageTabs'
import { nextSavedWindow, savedWindowCount, sortScheduleEditorRows } from './pageScheduleOverview'

function row(id: number, day: number, minute: number, enabled = true): PageTabSchedule {
  return { id, dayOfWeek: day, startMinute: minute, endMinute: minute + 60, enabled, sortOrder: id }
}
describe('Page overview saved schedule presentation', () => {
  it('orders Monday before Sunday and preserves original indexes for editing', () => {
    const input = [row(1, 0, 700), row(2, 2, 600), row(3, 1, 800), row(4, 1, 400), row(5, -1, 500)]
    expect(sortScheduleEditorRows(input).map(({ schedule }) => schedule.id)).toEqual([5, 4, 3, 2, 1])
    expect(sortScheduleEditorRows(input).map(({ index }) => index)).toEqual([4, 3, 2, 1, 0])
    expect(input.map((schedule) => schedule.id)).toEqual([1, 2, 3, 4, 5])
  })
  it('uses independent saved schedules per Page, not an unrelated runtime', () => {
    const monday = new Date(2026, 9, 12, 10, 0)
    expect(nextSavedWindow([row(1, 1, 480), row(2, 2, 540)], monday)?.getDay()).toBe(2)
    expect(nextSavedWindow([row(3, 1, 660)], monday)?.getHours()).toBe(11)
    expect(nextSavedWindow([row(5, 1, 600, false)], monday)).toBeNull()
    expect(savedWindowCount([row(5, 1, 600, false), row(6, 2, 500)])).toBe(1)
  })
  it('handles daily schedules over a local week boundary', () => {
    const next = nextSavedWindow([row(7, -1, 480)], new Date(2026, 9, 11, 23, 30))
    expect(next?.getDay()).toBe(1)
    expect(next?.getHours()).toBe(8)
    expect(next?.getDate()).toBe(12)
  })
})
