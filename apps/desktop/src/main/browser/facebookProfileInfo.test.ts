import { describe, expect, it } from 'vitest'
import {
  normalizeFacebookProfileName,
  pickFacebookProfileHeaderName,
  type FacebookProfileHeaderCandidate
} from './facebookProfileInfo'

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

describe('pickFacebookProfileHeaderName', () => {
  it('picks the large role=button profile name from the current Facebook header DOM', () => {
    const candidates: FacebookProfileHeaderCandidate[] = [
      { text: 'Edit profile', fontSizePx: 14, top: 300, visible: true, role: 'button', tabIndex: 0 },
      { text: 'Khương Bình', fontSizePx: 32, top: 292, visible: true, role: 'button', tabIndex: 0 },
      { text: "What's on your mind?", fontSizePx: 16, top: 510, visible: true, role: 'button', tabIndex: 0 }
    ]

    expect(pickFacebookProfileHeaderName(candidates)).toBe('Khương Bình')
  })

  it('ignores hidden, small and non-button candidates', () => {
    const candidates: FacebookProfileHeaderCandidate[] = [
      { text: 'Wrong hidden', fontSizePx: 32, top: 100, visible: false, role: 'button', tabIndex: 0 },
      { text: 'Wrong link', fontSizePx: 32, top: 110, visible: true, role: 'link', tabIndex: 0 },
      { text: 'Wrong small', fontSizePx: 18, top: 120, visible: true, role: 'button', tabIndex: 0 }
    ]

    expect(pickFacebookProfileHeaderName(candidates)).toBeNull()
  })
})
