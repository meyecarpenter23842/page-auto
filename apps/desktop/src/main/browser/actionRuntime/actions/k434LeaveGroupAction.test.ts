import { describe, expect, it } from 'vitest'
import { createK4ActionExecutorRegistry, createK434LeaveGroupActionExecutorRegistry } from './index'
import { configuredLeaveGroupUrls } from './leaveGroupAction'

describe('K4.3.4 leave group executor', () => {
  it('registers leave_group as its own executor', () => {
    const dependencies = { resolvePage: async () => null }
    const registry = createK434LeaveGroupActionExecutorRegistry({ leaveGroup: dependencies })
    expect(registry.has('leave_group')).toBe(true)
    expect(registry.has('group_interaction')).toBe(false)
  })

  it('wires leave group into the combined K4 registry with Common Runtime page dependency', () => {
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
    expect(registry.has('leave_group')).toBe(true)
  })

  it('normalizes and de-duplicates configured Group UID / URL targets', () => {
    expect(configuredLeaveGroupUrls({
      sourceTargets: '123\nhttps://www.facebook.com/groups/TestSlug/\n123\nhttps://www.facebook.com/groups/feed/'
    })).toEqual([
      'https://www.facebook.com/groups/123/',
      'https://www.facebook.com/groups/TestSlug/'
    ])
  })
})
