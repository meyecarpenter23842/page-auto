import { describe, expect, it } from 'vitest'
import { createK4ActionExecutorRegistry, createK432InviteFriendsGroupActionExecutorRegistry } from './index'
import {
  crossedPauseThreshold,
  inviteCandidateSignature,
  normalizeInviteGroupUrl
} from './inviteFriendsToGroupActionSupport'

describe('K4.3.2 invite friends to group executor', () => {
  it('registers invite_friends_to_group as its own executor', () => {
    const dependencies = { resolvePage: async () => null }
    const registry = createK432InviteFriendsGroupActionExecutorRegistry({ inviteFriendsToGroup: dependencies })
    expect(registry.has('invite_friends_to_group')).toBe(true)
    expect(registry.has('join_group')).toBe(false)
  })

  it('wires the action into the combined K4 registry using the existing group Common Runtime dependency', () => {
    const common = { resolvePage: async () => null }
    const registry = createK4ActionExecutorRegistry({
      view: { newsfeed: common, story: common, reel: common },
      friends: {
        friendInteraction: common,
        pokeFriend: common,
        sendFriendRequest: common,
        acceptFriendRequest: common,
        cancelSentFriendRequests: common,
        unfriend: common,
        friendFromEngagement: common
      },
      groups: { joinGroup: common }
    })
    expect(registry.has('join_group')).toBe(true)
    expect(registry.has('invite_friends_to_group')).toBe(true)
  })

  it('normalizes Group UID and Facebook URLs', () => {
    expect(normalizeInviteGroupUrl('123456')).toBe('https://www.facebook.com/groups/123456/')
    expect(normalizeInviteGroupUrl('facebook.com/groups/test')).toBe('https://facebook.com/groups/test')
    expect(normalizeInviteGroupUrl('https://www.facebook.com/groups/42/')).toBe('https://www.facebook.com/groups/42/')
  })

  it('builds stable friend signatures without the invite action label', () => {
    expect(inviteCandidateSignature('Nguyễn Văn A 12 bạn chung Mời')).toBe('Nguyễn Văn A 12 bạn chung')
    expect(inviteCandidateSignature('Invite John Doe 4 mutual friends')).toBe('John Doe 4 mutual friends')
    expect(inviteCandidateSignature('Invite')).toBe('')
  })

  it('pauses when a batch crosses the configured completed threshold', () => {
    expect(crossedPauseThreshold(28, 35, 30)).toBe(true)
    expect(crossedPauseThreshold(7, 14, 30)).toBe(false)
    expect(crossedPauseThreshold(30, 35, 30)).toBe(false)
    expect(crossedPauseThreshold(0, 30, 30)).toBe(true)
  })
})
