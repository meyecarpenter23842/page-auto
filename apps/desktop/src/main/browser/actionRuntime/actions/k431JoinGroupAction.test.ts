import { describe, expect, it } from 'vitest'
import type { ActionExecutorContext } from '../../../services/actionRunner'
import { createK431JoinGroupActionExecutorRegistry } from './index'
import { paceBrowserAction } from './actionSupport'
import {
  canAttemptAnotherJoin,
  crossedJoinPauseThreshold,
  detectGroupPrivacy,
  extractGroupMemberCount,
  groupIdentityFromHref,
  groupTextMatchesFilters,
  isDirectGroupPageUrl,
  normalizeGroupUrl,
  paceJoinGroup,
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

  it('hard-caps consequential join attempts at the configured target', () => {
    expect(canAttemptAnotherJoin(0, 2)).toBe(true)
    expect(canAttemptAnotherJoin(1, 2)).toBe(true)
    expect(canAttemptAnotherJoin(2, 2)).toBe(false)
    expect(canAttemptAnotherJoin(3, 2)).toBe(false)
  })

  it('extracts a stable group identity before Join changes the live button locator', () => {
    expect(groupIdentityFromHref('/groups/123456/?ref=share')).toBe('123456')
    expect(groupIdentityFromHref('https://www.facebook.com/groups/my-group/permalink/42/')).toBe('my-group')
    expect(groupIdentityFromHref('/groups/discover/')).toBeNull()
    expect(groupIdentityFromHref('/search/groups/?q=test')).toBeNull()
  })

  it('recognizes direct group pages but not discovery/search surfaces', () => {
    expect(isDirectGroupPageUrl('https://www.facebook.com/groups/123456/')).toBe(true)
    expect(isDirectGroupPageUrl('https://www.facebook.com/groups/my-group/?ref=share')).toBe(true)
    expect(isDirectGroupPageUrl('https://www.facebook.com/groups/discover/')).toBe(false)
    expect(isDirectGroupPageUrl('https://www.facebook.com/search/groups/?q=test')).toBe(false)
  })

  it('detects pacing threshold crossings by attempted joins', () => {
    expect(crossedJoinPauseThreshold(1, 2, 2)).toBe(true)
    expect(crossedJoinPauseThreshold(2, 3, 2)).toBe(false)
    expect(crossedJoinPauseThreshold(0, 1, 0)).toBe(false)
  })

  it('applies common browser pacing from Chrome settings between UI operations', async () => {
    const sleeps: number[] = []
    const context = {
      control: {
        isStopped: () => false,
        waitIfPaused: async () => undefined,
        sleep: async (delayMs: number) => { sleeps.push(delayMs) }
      }
    } as unknown as ActionExecutorContext

    const paced = await paceBrowserAction(context.control, {
      resolvePage: async () => null,
      actionDelayMinMs: 2500,
      actionDelayMaxMs: 2500
    })

    expect(paced).toBe(true)
    expect(sleeps.reduce((total, value) => total + value, 0)).toBe(2500)
  })

  it('applies configured delay between attempted joins even without a verified success', async () => {
    const sleeps: number[] = []
    const context = {
      control: {
        isStopped: () => false,
        waitIfPaused: async () => undefined,
        sleep: async (delayMs: number) => { sleeps.push(delayMs) }
      }
    } as unknown as ActionExecutorContext

    const paced = await paceJoinGroup(context, {
      pauseAfterCount: 0,
      pauseMinutes: 0,
      itemDelayMinSeconds: 3,
      itemDelayMaxSeconds: 3
    }, 0, 1)

    expect(paced).toBe(true)
    expect(sleeps.reduce((total, value) => total + value, 0)).toBe(3000)
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
