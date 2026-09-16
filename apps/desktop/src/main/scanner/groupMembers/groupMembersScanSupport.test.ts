import { describe, expect, it } from 'vitest'
import {
  groupIdFromFacebookUrl,
  groupMemberIdentityFromHref,
  groupMembersTargetFromValue,
  hasGroupMembersPermissionBlock,
  normalizeGroupMemberName,
  parseGroupMembersTargets
} from './groupMembersScanSupport'

describe('groupMembersScanSupport', () => {
  it('parses one or many Group UID/URL inputs and deduplicates source groups', () => {
    expect(parseGroupMembersTargets('1750186668328113\nhttps://www.facebook.com/groups/314765882317248/members\n1750186668328113')).toEqual([
      { raw: '1750186668328113', groupId: '1750186668328113', membersUrl: 'https://www.facebook.com/groups/1750186668328113/members' },
      { raw: 'https://www.facebook.com/groups/314765882317248/members', groupId: '314765882317248', membersUrl: 'https://www.facebook.com/groups/314765882317248/members' }
    ])
    expect(groupMembersTargetFromValue('https://example.com/groups/123')).toBeNull()
    expect(() => parseGroupMembersTargets('bán hàng')).toThrow(/chỉ hỗ trợ Group UID hoặc URL Group/)
  })

  it('extracts group identity from Facebook Group URLs for canonical verification', () => {
    expect(groupIdFromFacebookUrl('https://www.facebook.com/groups/1750186668328113/members')).toBe('1750186668328113')
    expect(groupIdFromFacebookUrl('https://www.facebook.com/groups/my-group/members')).toBe('my-group')
    expect(groupIdFromFacebookUrl('https://example.com/groups/1750186668328113/members')).toBeNull()
  })

  it('extracts member UID only from the live group-scoped member URL shape', () => {
    expect(groupMemberIdentityFromHref(
      'https://www.facebook.com/groups/1750186668328113/user/61594250075663/',
      '1750186668328113'
    )).toEqual({ groupId: '1750186668328113', memberUid: '61594250075663' })
    expect(groupMemberIdentityFromHref(
      'https://www.facebook.com/groups/999/user/61594250075663/',
      '1750186668328113'
    )).toBeNull()
    expect(groupMemberIdentityFromHref(
      'https://www.facebook.com/groups/1750186668328113/user/61594250075663/',
      'my-group'
    )).toBeNull()
    expect(groupMemberIdentityFromHref('https://www.facebook.com/profile.php?id=61594250075663')).toBeNull()
  })

  it('keeps only useful member names and detects permission blocks', () => {
    expect(normalizeGroupMemberName('  Nguyễn Văn A  ', '123')).toBe('Nguyễn Văn A')
    expect(normalizeGroupMemberName('Follow', '123')).toBe('123')
    expect(hasGroupMembersPermissionBlock('You must join this group to see members.')).toBe(true)
    expect(hasGroupMembersPermissionBlock('Public group · 462.4K members')).toBe(false)
  })
})
