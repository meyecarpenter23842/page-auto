import { describe, expect, it } from 'vitest'
import { createK431JoinGroupActionExecutorRegistry } from './index'
import {
  detectGroupPrivacy,
  extractGroupMemberCount,
  groupTextMatchesFilters,
  normalizeGroupUrl,
  textRequiresApproval
} from './joinGroupActionSupport'

describe('K4.3.1 join group executor', () => {
  it('registers join_group as its own executor', () => {
    const dependencies = { resolvePage: async () => null }
    const registry = createK431JoinGroupActionExecutorRegistry({ joinGroup: dependencies })
    expect(registry.has('join_group')).toBe(true)
    expect(registry.has('invite_friends_to_group')).toBe(false)
  })

  it('normalizes Group UID and Facebook URLs', () => {
    expect(normalizeGroupUrl('123456')).toBe('https://www.facebook.com/groups/123456/')
    expect(normalizeGroupUrl('facebook.com/groups/test')).toBe('https://facebook.com/groups/test')
    expect(normalizeGroupUrl('https://www.facebook.com/groups/42/')).toBe('https://www.facebook.com/groups/42/')
  })

  it('parses member counts and privacy from Vietnamese/English cards', () => {
    expect(extractGroupMemberCount('Nhóm công khai · 5,4K thành viên')).toBe(5400)
    expect(extractGroupMemberCount('Private group · 12,345 members')).toBe(12345)
    expect(detectGroupPrivacy('Nhóm công khai · 5K thành viên')).toBe('open')
    expect(detectGroupPrivacy('Private group · 10K members')).toBe('closed')
  })

  it('applies member/privacy/location and approval filters', () => {
    const config = {
      memberFilterEnabled: true,
      memberMin: 5000,
      privacyOpen: true,
      privacyClosed: false,
      skipApprovalRequired: true,
      locationEnabled: true,
      locationKeyword: 'Hồ Chí Minh',
      localeEnabled: false,
      locale: ''
    }
    expect(groupTextMatchesFilters('Nhóm công khai · 8K thành viên · Hồ Chí Minh', config)).toBe(true)
    expect(groupTextMatchesFilters('Nhóm riêng tư · 8K thành viên · Hồ Chí Minh', config)).toBe(false)
    expect(groupTextMatchesFilters('Nhóm công khai · 2K thành viên · Hồ Chí Minh', config)).toBe(false)
    expect(groupTextMatchesFilters('Nhóm công khai · 8K thành viên · Hà Nội', config)).toBe(false)
    expect(textRequiresApproval('Membership requires admin approval')).toBe(true)
    expect(groupTextMatchesFilters('Public group · 8K members · Hồ Chí Minh · requires admin approval', config)).toBe(false)
  })
})
