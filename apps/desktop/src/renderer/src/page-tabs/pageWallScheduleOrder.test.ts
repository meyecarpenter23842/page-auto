import { describe, expect, it } from 'vitest'
import { comparePageWallScheduleGroups, type PageWallScheduleOrderLike } from './pageWallScheduleOrder'

function daily(planId: number, weekday: number, minute: number): PageWallScheduleOrderLike {
  return {
    scheduleKind: 'daily',
    localDate: null,
    weekdays: [weekday],
    minutes: [minute],
    planIds: [planId]
  }
}

describe('Page Wall schedule list ordering', () => {
  it('sorts weekly schedules by weekday first and time second, with Sunday last', () => {
    const schedules = [
      daily(50, 4, 480),
      daily(80, 0, 480),
      daily(20, 1, 540),
      daily(30, 2, 540),
      daily(40, 3, 660),
      daily(70, 6, 540),
      daily(60, 5, 660),
      daily(21, 1, 605)
    ]

    expect(schedules.sort(comparePageWallScheduleGroups).map((item) => item.planIds[0])).toEqual([
      20,
      21,
      30,
      40,
      50,
      60,
      70,
      80
    ])
  })

  it('keeps equal weekday and time stable by plan id instead of runtime status', () => {
    const schedules = [daily(12, 3, 540), daily(10, 3, 540), daily(11, 3, 540)]
    expect(schedules.sort(comparePageWallScheduleGroups).map((item) => item.planIds[0])).toEqual([10, 11, 12])
  })

  it('preserves legacy specific-date schedules ahead of weekly schedules and sorts them by date then time', () => {
    const schedules: PageWallScheduleOrderLike[] = [
      daily(30, 1, 480),
      { scheduleKind: 'specific_date', localDate: '2026-09-26', weekdays: [], minutes: [540], planIds: [2] },
      { scheduleKind: 'specific_date', localDate: '2026-09-25', weekdays: [], minutes: [660], planIds: [3] },
      { scheduleKind: 'specific_date', localDate: '2026-09-25', weekdays: [], minutes: [480], planIds: [1] }
    ]

    expect(schedules.sort(comparePageWallScheduleGroups).map((item) => item.planIds[0])).toEqual([1, 3, 2, 30])
  })
})
