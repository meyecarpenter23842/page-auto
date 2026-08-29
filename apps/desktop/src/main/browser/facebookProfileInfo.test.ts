import { describe, expect, it } from 'vitest'
import { normalizeFacebookProfileName } from './facebookProfileInfo'

describe('normalizeFacebookProfileName', () => {
  it('keeps a real Facebook display name', () => {
    expect(normalizeFacebookProfileName('Aneesa Garrison')).toBe('Aneesa Garrison')
    expect(normalizeFacebookProfileName('Aneesa Garrison | Facebook')).toBe('Aneesa Garrison')
    expect(normalizeFacebookProfileName('(20+) Aneesa Garrison | Facebook')).toBe('Aneesa Garrison')
  })

  it('rejects notification/tab titles instead of treating them as an account name', () => {
    expect(normalizeFacebookProfileName('(20+) Facebook')).toBeNull()
    expect(normalizeFacebookProfileName('(4) Facebook')).toBeNull()
    expect(normalizeFacebookProfileName('Facebook')).toBeNull()
  })
})
