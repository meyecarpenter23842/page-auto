import { describe, expect, it } from 'vitest'
import { chooseFacebookDisplayName } from './scannerDisplayName'

describe('chooseFacebookDisplayName', () => {
  it('prefers source-backed names and strips Facebook title suffixes', () => {
    expect(chooseFacebookDisplayName(['Nhóm Mỹ Tho', 'Nhóm Mỹ Tho | Facebook'], '123')).toBe('Nhóm Mỹ Tho')
    expect(chooseFacebookDisplayName([null, 'Page Auto - Facebook'], '456')).toBe('Page Auto')
    expect(chooseFacebookDisplayName(['456', 'Page Auto · Facebook'], '456')).toBe('Page Auto')
  })

  it('ignores generic Facebook-only titles and keeps an honest fallback', () => {
    expect(chooseFacebookDisplayName(['Facebook', '   '], '789')).toBe('789')
  })
})
