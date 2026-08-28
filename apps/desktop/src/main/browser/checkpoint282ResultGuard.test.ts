import { describe, expect, it } from 'vitest'
import {
  consumeCheckpoint282StaleResult,
  markCheckpoint282ResultStale
} from './checkpoint282ResultGuard'

describe('checkpoint282ResultGuard', () => {
  it('ignores exactly one late result per timed out request', () => {
    let staleCount = 0
    staleCount = markCheckpoint282ResultStale(staleCount)
    staleCount = markCheckpoint282ResultStale(staleCount)

    const first = consumeCheckpoint282StaleResult(staleCount)
    expect(first).toEqual({ ignore: true, remaining: 1 })

    const second = consumeCheckpoint282StaleResult(first.remaining)
    expect(second).toEqual({ ignore: true, remaining: 0 })

    const current = consumeCheckpoint282StaleResult(second.remaining)
    expect(current).toEqual({ ignore: false, remaining: 0 })
  })

  it('normalizes invalid counters instead of creating negative stale debt', () => {
    expect(markCheckpoint282ResultStale(-3)).toBe(1)
    expect(consumeCheckpoint282StaleResult(-2)).toEqual({ ignore: false, remaining: 0 })
  })
})
