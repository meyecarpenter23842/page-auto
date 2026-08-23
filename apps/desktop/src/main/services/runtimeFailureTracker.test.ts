import { describe, expect, it } from 'vitest'
import { ConsecutiveFailureTracker } from './runtimeFailureTracker'

describe('ConsecutiveFailureTracker', () => {
  it('trips only after logical run-item failures reach the configured limit', () => {
    const tracker = new ConsecutiveFailureTracker()

    expect(tracker.record(1, 10, 'failed', true, 3)).toEqual({ count: 1, limitReached: false })
    expect(tracker.record(1, 10, 'failed', true, 3)).toEqual({ count: 2, limitReached: false })
    expect(tracker.record(1, 10, 'failed', true, 3)).toEqual({ count: 3, limitReached: true })
  })

  it('resets after success and ignores preflight failures without a claimed item', () => {
    const tracker = new ConsecutiveFailureTracker()
    tracker.record(1, 10, 'failed', true, 2)
    expect(tracker.record(1, 10, 'success', true, 2)).toEqual({ count: 0, limitReached: false })
    expect(tracker.record(1, 10, 'failed', true, 2)).toEqual({ count: 1, limitReached: false })
    expect(tracker.record(1, 10, 'failed', false, 2)).toEqual({ count: 0, limitReached: false })
  })

  it('keeps account/run counters independent', () => {
    const tracker = new ConsecutiveFailureTracker()
    tracker.record(1, 10, 'failed', true, 2)
    expect(tracker.record(1, 20, 'failed', true, 2).limitReached).toBe(false)
    expect(tracker.record(2, 10, 'failed', true, 2).limitReached).toBe(false)
    expect(tracker.record(1, 10, 'failed', true, 2).limitReached).toBe(true)
  })
})
