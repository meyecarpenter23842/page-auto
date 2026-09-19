import { describe, expect, it } from 'vitest'
import {
  composePageWallRuntimeContent,
  ensurePageWallHashtagPeriod
} from './pageWallHashtags'

describe('Page Wall canonical hashtags', () => {
  it('forces one terminal period on the resolved hashtag block', () => {
    expect(ensurePageWallHashtagPeriod('#BillMafia')).toBe('#BillMafia.')
    expect(ensurePageWallHashtagPeriod('#BillMafia.')).toBe('#BillMafia.')
    expect(ensurePageWallHashtagPeriod('   ')).toBe('')
  })

  it('spins content and hashtag sources independently before appending hashtags', () => {
    const values = [0.99, 0]
    let index = 0
    expect(composePageWallRuntimeContent(
      '{Bài A|Bài B}',
      '{#BillMafia|#fomo} #PageAuto',
      { random: () => values[index++] ?? 0 }
    )).toBe('Bài B\n\n#BillMafia #PageAuto.')
    expect(index).toBe(2)
  })

  it('keeps legacy Page Wall behavior when the library post has no hashtag metadata', () => {
    expect(composePageWallRuntimeContent('{A|B}', '', { random: () => 0.99 })).toBe('B')
  })
})
