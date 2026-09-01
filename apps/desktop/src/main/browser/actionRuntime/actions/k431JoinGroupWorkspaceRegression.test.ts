import { describe, expect, it } from 'vitest'
import type { ActionExecutorContext } from '../../../services/actionRunner'
import { groupTextMatchesFilters, pauseAfterJoinOutcome } from './joinGroupActionSupport'

describe('K4.3.1 group workspace regression', () => {
  it('enforces both lower and upper member bounds when enabled', () => {
    const config = {
      memberFilterEnabled: true,
      memberMin: 10_000,
      memberMax: 50_000,
      privacyOpen: true,
      privacyClosed: true,
      skipApprovalRequired: false,
      answerQuestions: '',
      locationEnabled: false,
      locationKeyword: '',
      localeEnabled: false,
      locale: ''
    }
    expect(groupTextMatchesFilters('Public group · 9K members', config)).toBe(false)
    expect(groupTextMatchesFilters('Public group · 25K members', config)).toBe(true)
    expect(groupTextMatchesFilters('Public group · 51K members', config)).toBe(false)
  })

  it('adds the configured error pause only after an unverified join outcome', async () => {
    const sleeps: number[] = []
    const context = {
      control: {
        isStopped: () => false,
        waitIfPaused: async () => undefined,
        sleep: async (delayMs: number) => { sleeps.push(delayMs) }
      }
    } as unknown as ActionExecutorContext

    expect(await pauseAfterJoinOutcome(context, { errorPauseMinutes: 2 }, 'joined')).toBe(true)
    expect(sleeps).toEqual([])
    expect(await pauseAfterJoinOutcome(context, { errorPauseMinutes: 2 }, 'unverified')).toBe(true)
    expect(sleeps).toEqual([120_000])
  })
})
