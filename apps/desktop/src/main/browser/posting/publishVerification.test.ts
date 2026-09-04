import { describe, expect, it } from 'vitest'
import {
  absoluteFacebookPostUrl,
  facebookPostKey,
  groupMyPostedContentUrl,
  isNewFacebookPostHref,
  publishContentFingerprint,
  publishContentMatches,
  publishContentMatchesAtLeast,
  singleNewFacebookPostFromHrefs,
  type PublishBaseline
} from './publishVerification'

describe('strong publish verification helpers', () => {
  it('extracts stable post IDs from numeric and Page pfbid permalink shapes', () => {
    expect(facebookPostKey('/groups/111/posts/222/?__cft__=abc')).toBe('post:222')
    expect(facebookPostKey('https://www.facebook.com/permalink.php?story_fbid=333&id=444')).toBe('post:333')
    expect(facebookPostKey('/MyPage/posts/pfbid02AbCdEf123_/')).toBe('post:pfbid02AbCdEf123_')
    expect(facebookPostKey('https://www.facebook.com/MyPage/permalink/pfbid0ZXcvbnM456-')).toBe('post:pfbid0ZXcvbnM456-')
    expect(facebookPostKey('https://www.facebook.com/permalink.php?story_fbid=pfbid0Story123&id=444')).toBe('post:pfbid0Story123')
    expect(facebookPostKey('/groups/111')).toBeNull()
    expect(facebookPostKey('/Page/posts/a')).toBeNull()
    expect(facebookPostKey('https://example.com/posts/222')).toBeNull()
  })

  it('requires a post key that was not present before clicking publish', () => {
    const baseline: PublishBaseline = { captured: true, postKeys: new Set(['post:222', 'post:pfbidOld']) }
    expect(isNewFacebookPostHref('/groups/111/posts/222/', baseline)).toBe(false)
    expect(isNewFacebookPostHref('/MyPage/posts/pfbidOld/', baseline)).toBe(false)
    expect(isNewFacebookPostHref('/groups/111/posts/333/', baseline)).toBe(true)
    expect(isNewFacebookPostHref('/MyPage/posts/pfbidNew/', baseline)).toBe(true)
    expect(isNewFacebookPostHref('/profile.php?id=123', baseline)).toBe(false)
  })

  it('does not trust DOM-diff verification if baseline capture failed', () => {
    const baseline: PublishBaseline = { captured: false, postKeys: new Set() }
    expect(isNewFacebookPostHref('/groups/111/posts/333/', baseline)).toBe(false)
  })

  it('normalizes compact content fingerprints and tolerates invisible Facebook text separators', () => {
    const long = '  hello   world\nagain ' + 'x'.repeat(100)
    expect(publishContentFingerprint(long)).toHaveLength(48)
    expect(publishContentMatches('prefix hello\u200B world again ' + 'x'.repeat(80), long)).toBe(true)
    expect(publishContentMatches('completely different body', long)).toBe(false)
    expect(absoluteFacebookPostUrl('/groups/111/posts/333/')).toBe('https://www.facebook.com/groups/111/posts/333/')
  })

  it('keeps the Group default at 12 characters instead of allowing one-character substring matches', () => {
    expect(publishContentMatches('prefix short suffix', 'short')).toBe(false)
    expect(publishContentMatchesAtLeast('prefix short suffix', 'short', 1)).toBe(true)
    expect(publishContentMatchesAtLeast('different text', 'short', 1)).toBe(false)
  })

  it('accepts key-only fallback only when exactly one unique new post exists after baseline', () => {
    const baseline: PublishBaseline = { captured: true, postKeys: new Set(['post:old']) }
    const single = singleNewFacebookPostFromHrefs([
      '/Page/posts/old/',
      '/Page/posts/pfbidNew/',
      '/Page/posts/pfbidNew/?comment_id=1'
    ], baseline)

    expect(single).toEqual({
      postKey: 'post:pfbidNew',
      publishedUrl: 'https://www.facebook.com/Page/posts/pfbidNew/'
    })

    expect(singleNewFacebookPostFromHrefs([
      '/Page/posts/pfbidNew/',
      '/Page/posts/pfbidAnother/'
    ], baseline)).toBeNull()
  })

  it('builds my_posted_content from the current Group UID instead of a fixed UID', () => {
    expect(groupMyPostedContentUrl('1135978350588987')).toBe(
      'https://www.facebook.com/groups/1135978350588987/my_posted_content'
    )
    expect(groupMyPostedContentUrl(' 1482164882666280 ')).toBe(
      'https://www.facebook.com/groups/1482164882666280/my_posted_content'
    )
  })
})
