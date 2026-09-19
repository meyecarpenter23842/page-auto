import { describe, expect, it } from 'vitest'
import {
  composePageWallRuntimeContent,
  ensurePageWallHashtagPeriod
} from './pageWallHashtags'

describe('Page Wall separate hashtags', () => {
  it('adds exactly one terminal period to a resolved hashtag block', () => {
    expect(ensurePageWallHashtagPeriod('#sale #hot')).toBe('#sale #hot.')
    expect(ensurePageWallHashtagPeriod('#sale #hot.')).toBe('#sale #hot.')
    expect(ensurePageWallHashtagPeriod('   ')).toBe('')
  })

  it('spins content first, spins hashtags separately, then appends hashtags at the end', () => {
    const values = [0.99, 0]
    let index = 0
    const result = composePageWallRuntimeContent(
      '{Bài A|Bài B}',
      '{#sale|#hot}',
      { random: () => values[index++] ?? 0 }
    )

    expect(result).toBe('Bài B\n\n#sale.')
    expect(index).toBe(2)
  })

  it('keeps existing Page Wall behavior when no separate hashtags are configured', () => {
    expect(composePageWallRuntimeContent('{A|B}', '', { random: () => 0.99 })).toBe('B')
  })
})
