import { describe, expect, it } from 'vitest'
import { shouldEndPageIdentityForUnavailableAccess } from './pageIdentitySwitcher'

describe('Page identity access policy', () => {
  it('ends the Page-switch attempt only after first-pass fallbacks confirm a target missing from managed Pages', () => {
    expect(shouldEndPageIdentityForUnavailableAccess('not_listed', true)).toBe(true)
    expect(shouldEndPageIdentityForUnavailableAccess('not_listed', false)).toBe(false)
    expect(shouldEndPageIdentityForUnavailableAccess('present', true)).toBe(false)
    expect(shouldEndPageIdentityForUnavailableAccess('unknown', true)).toBe(false)
  })
})
