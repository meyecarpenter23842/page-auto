import { describe, expect, it } from 'vitest'
import {
  absoluteFacebookPostUrl,
  facebookPostKey,
  groupMyPostedContentUrl,
  isNewFacebookPostHref,
  publishContentFingerprint,
  type PublishBaseline
} from './publishVerification'

describe('strong publish verification helpers', () => {
  it('extracts stable post IDs from supported Facebook permalink shapes', () => {
    expect(facebookPostKey('/groups/111/posts/222/?__cft__=abc')).toBe('post:222')
    expect(facebookPostKey('https://www.facebook.com/permalink.php?story_fbid=333&id=444')).toBe('post:333')
    expect(facebookPostKey('/groups/111')).toBeNull()
    expect(facebookPostKey('https://example.com/posts/222')).toBeNull()
  })

  it('requires a post key that was not present before clicking publish', () => {
    const baseline: PublishBaseline = { captured: true, postKeys: new Set(['post:222']) }
    expect(isNewFacebookPostHref('/groups/111/posts/222/', baseline)).toBe(false)
    expect(isNewFacebookPostHref('/groups/111/posts/333/', baseline)).toBe(true)
    expect(isNewFacebookPostHref('/profile.php?id=123', baseline)).toBe(false)
  })

  it('does not trust DOM-diff verification if baseline capture failed', () => {
    const baseline: PublishBaseline = { captured: false, postKeys: new Set() }
    expect(isNewFacebookPostHref('/groups/111/posts/333/', baseline)).toBe(false)
  })

  it('normalizes content fingerprints and absolute Facebook URLs', () => {
    expect(publishContentFingerprint('  hello   world\nagain ')).toBe('hello world again')
    expect(absoluteFacebookPostUrl('/groups/111/posts/333/')).toBe('https://www.facebook.com/groups/111/posts/333/')
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
