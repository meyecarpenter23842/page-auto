import { describe, expect, it } from 'vitest'
import { requireVerifiedUserUid, userUidFromAppLink } from './userScanIdentity'

describe('userScanIdentity', () => {
  it('accepts only profile app-link UID evidence', () => {
    expect(userUidFromAppLink('fb://profile/123456789')).toBe('123456789')
    expect(userUidFromAppLink('fb://profile/?id=987654321')).toBe('987654321')
    expect(userUidFromAppLink('fb://page/123456789')).toBeNull()
    expect(userUidFromAppLink(null)).toBeNull()
  })

  it('requires loaded profile UID evidence and exact direct UID match', () => {
    expect(requireVerifiedUserUid(null, '123')).toBe('123')
    expect(requireVerifiedUserUid('123', '123')).toBe('123')
    expect(() => requireVerifiedUserUid('123', '456')).toThrow(/không khớp UID yêu cầu/)
    expect(() => requireVerifiedUserUid('123', null)).toThrow(/Không xác minh được UID người dùng/)
  })
})
