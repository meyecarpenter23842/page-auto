import { describe, expect, it } from 'vitest'
import {
  extractPageFollowerCount,
  extractPageLikeCount,
  normalizePageUrl,
  pageUidFromHref,
  pageUsernameFromHref,
  parsePageScanQuery
} from './pageScanSupport'

describe('pageScanSupport', () => {
  it('parses direct Page UID/URL lists without treating a vanity slug as the UID', () => {
    expect(parsePageScanQuery('123\nhttps://www.facebook.com/profile.php?id=456\nfacebook.com/page.auto')).toEqual({
      kind: 'direct',
      targets: [
        { raw: '123', url: 'https://www.facebook.com/123/', uid: '123' },
        { raw: 'https://www.facebook.com/profile.php?id=456', url: 'https://www.facebook.com/profile.php?id=456', uid: '456' },
        { raw: 'facebook.com/page.auto', url: 'https://www.facebook.com/page.auto/', uid: null }
      ]
    })
    expect(parsePageScanQuery('page auto tips')).toEqual({ kind: 'keyword', keyword: 'page auto tips' })
  })

  it('accepts only verified numeric Page UID surfaces and separately exposes username', () => {
    expect(pageUidFromHref('https://www.facebook.com/123456/')).toBe('123456')
    expect(pageUidFromHref('https://www.facebook.com/profile.php?id=987')).toBe('987')
    expect(pageUidFromHref('https://www.facebook.com/page.auto')).toBeNull()
    expect(pageUsernameFromHref('https://www.facebook.com/page.auto/?ref=search')).toBe('page.auto')
    expect(pageUsernameFromHref('https://www.facebook.com/groups/123')).toBeNull()
    expect(normalizePageUrl('https://example.com/page.auto')).toBeNull()
  })

  it('extracts only explicitly labelled follower/like counts', () => {
    expect(extractPageFollowerCount('Software · 12.5K followers')).toBe(12_500)
    expect(extractPageFollowerCount('8,2K người theo dõi')).toBe(8_200)
    expect(extractPageLikeCount('10K likes · 12K followers')).toBe(10_000)
    expect(extractPageLikeCount('9.500 lượt thích')).toBe(9_500)
    expect(extractPageFollowerCount('Page 12345')).toBeNull()
  })
})
