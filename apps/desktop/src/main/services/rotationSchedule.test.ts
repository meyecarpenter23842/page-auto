import { describe, expect, it } from 'vitest'
import {
  isWithinSchedule,
  nextScheduleStart,
  nextScheduleStartAfterDay,
  nextScheduleWindowStart,
  randomDelaySeconds,
  scheduleWindowKey
} from './rotationSchedule'

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

  it('assigns a stable identity to each active window', () => {
    const windows = [
      { dayOfWeek: 1, startMinute: 420, endMinute: 720, enabled: true, sortOrder: 0 },
      { dayOfWeek: 1, startMinute: 780, endMinute: 1080, enabled: true, sortOrder: 1 }
    ]
    const morning = new Date(2026, 7, 24, 9, 0)
    const afternoon = new Date(2026, 7, 24, 14, 0)
    const gap = new Date(2026, 7, 24, 12, 30)

    expect(scheduleWindowKey(windows, morning)).toBe('2026-08-24:0:420-720')
    expect(scheduleWindowKey(windows, afternoon)).toBe('2026-08-24:1:780-1080')
    expect(scheduleWindowKey(windows, gap)).toBeNull()
    expect(scheduleWindowKey([], morning)).toBe('2026-08-24:all-day')
  })

  it('calculates the next schedule window including same-day windows', () => {
    const windows = [
      { dayOfWeek: 1, startMinute: 420, endMinute: 720, enabled: true, sortOrder: 0 },
      { dayOfWeek: 1, startMinute: 780, endMinute: 1080, enabled: true, sortOrder: 1 }
    ]
    const morning = new Date(2026, 7, 24, 9, 0)
    const next = nextScheduleWindowStart(windows, morning)
    expect(next.getDate()).toBe(24)
    expect(next.getHours()).toBe(13)
    expect(next.getMinutes()).toBe(0)

    const alwaysOnNext = nextScheduleWindowStart([], morning)
    expect(alwaysOnNext.getDate()).toBe(25)
    expect(alwaysOnNext.getHours()).toBe(0)
    expect(alwaysOnNext.getMinutes()).toBe(0)
  })

  it('calculates the next run day and uses midnight for always-on tabs', () => {
    const mondayAndTuesday = [
      ...mondayWindow,
      { dayOfWeek: 2, startMinute: 480, endMinute: 540, enabled: true, sortOrder: 1 }
    ]
    const monday = new Date(2026, 7, 24, 10, 30)
    const next = nextScheduleStartAfterDay(mondayAndTuesday, monday)
    expect(next.getDay()).toBe(2)
    expect(next.getHours()).toBe(8)
    expect(next.getMinutes()).toBe(0)

    const alwaysOnNext = nextScheduleStartAfterDay([], monday)
    expect(alwaysOnNext.getDate()).toBe(25)
    expect(alwaysOnNext.getHours()).toBe(0)
    expect(alwaysOnNext.getMinutes()).toBe(0)
  })

  it('chooses inclusive random delay bounds', () => {
    expect(randomDelaySeconds(5, 10, () => 0)).toBe(5)
    expect(randomDelaySeconds(5, 10, () => 0.999999)).toBe(10)
  })
})
