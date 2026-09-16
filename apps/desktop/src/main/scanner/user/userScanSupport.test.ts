import { describe, expect, it } from 'vitest'
import {
  extractUserFollowerCount,
  normalizeUserProfileUrl,
  parseUserScanTargets,
  userUidFromHref,
  userUsernameFromHref
} from './userScanSupport'

describe('userScanSupport', () => {
  it('parses UID and profile URL lists without treating vanity username as UID', () => {
    expect(parseUserScanTargets('123\nhttps://www.facebook.com/profile.php?id=456\nfacebook.com/user.name')).toEqual([
      { raw: '123', url: 'https://www.facebook.com/profile.php?id=123', uid: '123', username: null },
      { raw: 'https://www.facebook.com/profile.php?id=456', url: 'https://www.facebook.com/profile.php?id=456', uid: '456', username: null },
      { raw: 'facebook.com/user.name', url: 'https://www.facebook.com/user.name/', uid: null, username: 'user.name' }
    ])
  })

  it('rejects non-profile Facebook surfaces and external hosts', () => {
    expect(normalizeUserProfileUrl('https://www.facebook.com/groups/123')).toBeNull()
    expect(normalizeUserProfileUrl('https://example.com/user.name')).toBeNull()
    expect(() => parseUserScanTargets('some person keyword')).toThrow(/chỉ hỗ trợ UID hoặc URL Profile/)
  })

  it('extracts numeric IDs and usernames separately', () => {
    expect(userUidFromHref('https://www.facebook.com/profile.php?id=987')).toBe('987')
    expect(userUidFromHref('https://www.facebook.com/123456/')).toBe('123456')
    expect(userUidFromHref('https://www.facebook.com/people/Test/555')).toBe('555')
    expect(userUsernameFromHref('https://www.facebook.com/user.name')).toBe('user.name')
    expect(userUsernameFromHref('https://www.facebook.com/groups/123')).toBeNull()
  })

  it('extracts only explicitly labelled follower counts', () => {
    expect(extractUserFollowerCount('1.2K followers')).toBe(1_200)
    expect(extractUserFollowerCount('8,2K người theo dõi')).toBe(8_200)
    expect(extractUserFollowerCount('UID 123456')).toBeNull()
  })
})
