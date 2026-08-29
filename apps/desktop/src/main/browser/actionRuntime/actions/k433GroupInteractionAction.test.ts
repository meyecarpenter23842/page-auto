import { describe, expect, it } from 'vitest'
import { createK4ActionExecutorRegistry, createK433GroupInteractionActionExecutorRegistry } from './index'
import {
  groupInteractionTargetsSatisfied,
  type GroupInteractionStats,
  type GroupTargets
} from './groupInteractionAction'
import {
  classifyGroupRestriction,
  configuredGroupWhitelist,
  groupIdentityAllowed
} from './groupInteractionActionSupport'

describe('K4.3.3 group interaction executor', () => {
  it('registers group_interaction as its own executor', () => {
    const dependencies = { resolvePage: async () => null }
    const registry = createK433GroupInteractionActionExecutorRegistry({ groupInteraction: dependencies })
    expect(registry.has('group_interaction')).toBe(true)
    expect(registry.has('join_group')).toBe(false)
  })

  it('wires group interaction into the combined K4 registry with Common Runtime page dependency', () => {
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
    expect(registry.has('group_interaction')).toBe(true)
  })

  it('normalizes and applies a Group UID whitelist', () => {
    const whitelist = configuredGroupWhitelist({
      groupWhitelist: '123\nhttps://www.facebook.com/groups/TestSlug/\n123'
    })
    expect(whitelist).toEqual(['123', 'testslug'])
    expect(groupIdentityAllowed('123', whitelist)).toBe(true)
    expect(groupIdentityAllowed('other', whitelist)).toBe(false)
    expect(groupIdentityAllowed(null, [])).toBe(true)
  })

  it('classifies Facebook restriction messages without bypassing them', () => {
    expect(classifyGroupRestriction('You can\'t comment in this group right now.')).toBe('comment_blocked')
    expect(classifyGroupRestriction('Bạn không thể đăng trong nhóm này.')).toBe('posting_blocked')
    expect(classifyGroupRestriction('Your account is temporarily restricted.')).toBe('temporarily_restricted')
    expect(classifyGroupRestriction('Bài viết bình thường trong nhóm.')).toBeNull()
  })

  it('requires every configured interaction target before treating the action as complete', () => {
    const stats: GroupInteractionStats = {
      groupsVisited: 1,
      postsSeen: 1,
      viewed: 1,
      reacted: 1,
      commented: 0,
      commentsDeleted: 0,
      sharedToWall: 0,
      sharedToGroup: 0,
      restricted: 0,
      groupsLeft: 0,
      skipped: 0,
      failed: 0
    }
    const targets: GroupTargets = {
      views: 1,
      reactions: 1,
      comments: 0,
      wallShares: 1,
      groupShares: 0
    }

    expect(groupInteractionTargetsSatisfied(stats, targets)).toBe(false)
    expect(groupInteractionTargetsSatisfied({ ...stats, sharedToWall: 1 }, targets)).toBe(true)
  })
})
