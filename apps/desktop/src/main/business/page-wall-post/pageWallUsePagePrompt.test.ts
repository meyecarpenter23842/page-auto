import { describe, expect, it } from 'vitest'
import {
  isPageWallUsePageAccessibleName,
  resolvePageWallUsePageDecision
} from './pageWallUsePagePrompt'

describe('Page Wall Use Page prompt ownership', () => {
  it('matches only the supported Use Page labels', () => {
    expect(isPageWallUsePageAccessibleName('Use Page')).toBe(true)
    expect(isPageWallUsePageAccessibleName('Use this Page')).toBe(true)
    expect(isPageWallUsePageAccessibleName('Dùng Trang')).toBe(true)
    expect(isPageWallUsePageAccessibleName('Sử dụng Trang này')).toBe(true)
    expect(isPageWallUsePageAccessibleName('Use profile')).toBe(false)
    expect(isPageWallUsePageAccessibleName('Continue')).toBe(false)
  })

  it('clicks exactly one owned CTA and refuses ambiguous matches', () => {
    expect(resolvePageWallUsePageDecision(0)).toBe('skip')
    expect(resolvePageWallUsePageDecision(1)).toBe('click')
    expect(resolvePageWallUsePageDecision(2)).toBe('ambiguous')
  })
})
