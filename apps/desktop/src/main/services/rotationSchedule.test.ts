import { describe, expect, it } from 'vitest'
import { isWithinSchedule, nextScheduleStart, randomDelaySeconds } from './rotationSchedule'

const mondayWindow = [{
  dayOfWeek: 1,
  startMinute: 600,
  endMinute: 660,
  enabled: true,
  sortOrder: 0
}]

describe('rotationSchedule', () => {
  it('allows all times when no enabled schedule exists', () => {
    expect(isWithinSchedule([], new Date(2026, 7, 24, 3, 0))).toBe(true)
    expect(isWithinSchedule([{ ...mondayWindow[0]!, enabled: false }], new Date(2026, 7, 24, 3, 0))).toBe(true)
  })

  it('detects active windows and calculates the next local start', () => {
    const before = new Date(2026, 7, 24, 9, 30)
    const inside = new Date(2026, 7, 24, 10, 30)
    const after = new Date(2026, 7, 24, 11, 30)

    expect(isWithinSchedule(mondayWindow, before)).toBe(false)
    expect(isWithinSchedule(mondayWindow, inside)).toBe(true)
    expect(isWithinSchedule(mondayWindow, after)).toBe(false)
    expect(nextScheduleStart(mondayWindow, before)?.getHours()).toBe(10)
    expect(nextScheduleStart(mondayWindow, after)?.getDate()).toBe(31)
  })

  it('chooses inclusive random delay bounds', () => {
    expect(randomDelaySeconds(5, 10, () => 0)).toBe(5)
    expect(randomDelaySeconds(5, 10, () => 0.999999)).toBe(10)
  })
})
