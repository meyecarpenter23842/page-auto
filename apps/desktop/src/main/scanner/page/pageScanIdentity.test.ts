import { describe, expect, it } from 'vitest'
import { pageUidFromAppLink, requireVerifiedPageUid } from './pageScanIdentity'

describe('pageScanIdentity', () => {
  it('accepts only Page-specific Facebook app links as UID evidence', () => {
    expect(pageUidFromAppLink('fb://page/?id=123456')).toBe('123456')
    expect(pageUidFromAppLink('fb://page/987654')).toBe('987654')
    expect(pageUidFromAppLink('fb://profile/123456')).toBeNull()
    expect(pageUidFromAppLink('https://www.facebook.com/123456/')).toBeNull()
    expect(pageUidFromAppLink(null)).toBeNull()
  })

  it('requires Page-specific evidence and rejects a redirect to a different UID', () => {
    expect(requireVerifiedPageUid(null, '123')).toBe('123')
    expect(requireVerifiedPageUid('123', '123')).toBe('123')
    expect(() => requireVerifiedPageUid('123', null)).toThrow(/Không xác minh được Page UID/)
    expect(() => requireVerifiedPageUid('123', '456')).toThrow(/không khớp UID yêu cầu/)
  })
})
