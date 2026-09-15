import { describe, expect, it } from 'vitest'
import {
  detectGroupPrivacy,
  extractGroupMemberCount,
  groupIdentityFromHref,
  hasTemporaryGroupRestriction,
  groupRecordMatchesFilters,
  parseGroupScanQuery,
  scanJobStatusFromFacebookAccess
} from './groupScanSupport'

describe('Group scanner parsing', () => {
  it('separates keyword search from direct UID/URL input without guessing a single slug as an ID', () => {
    expect(parseGroupScanQuery('mỹ phẩm HCM')).toEqual({ kind: 'keyword', keyword: 'mỹ phẩm HCM' })
    expect(parseGroupScanQuery('123456')).toEqual({ kind: 'direct', targets: ['123456'] })
    expect(parseGroupScanQuery('https://www.facebook.com/groups/987654/')).toEqual({ kind: 'direct', targets: ['987654'] })
    expect(parseGroupScanQuery('123\n123\n456')).toEqual({ kind: 'direct', targets: ['123', '456'] })
  })

  it('normalizes Group identity and parses nullable members/privacy metadata', () => {
    expect(groupIdentityFromHref('/groups/12345/?ref=share')).toBe('12345')
    expect(groupIdentityFromHref('/groups/discover/')).toBeNull()
    expect(extractGroupMemberCount('Nhóm Công khai · 12,5K thành viên')).toBe(12500)
    expect(extractGroupMemberCount('No member count')).toBeNull()
    expect(detectGroupPrivacy('Public group · 1.2K members')).toBe('Public')
    expect(detectGroupPrivacy('Nhóm riêng tư')).toBe('Private')
    expect(detectGroupPrivacy('Không có privacy metadata')).toBeNull()
  })

  it('recognizes the source-proven temporary Group restriction wording', () => {
    expect(hasTemporaryGroupRestriction('You are temporarily restricted from doing this.')).toBe(true)
    expect(hasTemporaryGroupRestriction('Tài khoản của bạn hiện bị hạn chế')).toBe(true)
    expect(hasTemporaryGroupRestriction('Public group · 10K members')).toBe(false)
  })

  it('maps login/checkpoint access failures to needs_attention without bypassing Common Runtime', () => {
    expect(scanJobStatusFromFacebookAccess({ status: 'needs_login', code: 'needs_login' })).toBe('needs_attention')
    expect(scanJobStatusFromFacebookAccess({ status: 'needs_login', code: 'verification_required' })).toBe('needs_attention')
    expect(scanJobStatusFromFacebookAccess({ status: 'failed', code: 'browser_launch_failed' })).toBe('failed')
  })

  it('applies Scanner Group filters client-side only when the required metadata/text matches', () => {
    const record = { members: 25000, privacy: 'Public' as const, rawText: 'Mỹ phẩm Hồ Chí Minh · Public · 25K members' }
    expect(groupRecordMatchesFilters(record, { membersMin: 10000, privacy: 'public', location: 'Hồ Chí Minh' })).toBe(true)
    expect(groupRecordMatchesFilters(record, { membersMin: 30000 })).toBe(false)
    expect(groupRecordMatchesFilters({ members: null, privacy: null, rawText: '' }, { membersMin: 1 })).toBe(false)
  })
})
