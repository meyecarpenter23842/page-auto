import { describe, expect, it } from 'vitest'
import { createK42FriendActionExecutorRegistry } from './index'

describe('K4.2 executor registry', () => {
  it('registers seven friend actions as separate executors', () => {
    const resolvePage = async () => null
    const dependencies = { resolvePage }
    const registry = createK42FriendActionExecutorRegistry({
      friendInteraction: dependencies,
      pokeFriend: dependencies,
      sendFriendRequest: dependencies,
      acceptFriendRequest: dependencies,
      cancelSentFriendRequests: dependencies,
      unfriend: dependencies,
      friendFromEngagement: dependencies
    })
    for (const actionType of ['friend_interaction','poke_friend','send_friend_request','accept_friend_request','cancel_sent_friend_requests','unfriend','friend_from_engagement']) {
      expect(registry.has(actionType)).toBe(true)
    }
    expect(registry.has('birthday_greeting')).toBe(false)
  })
})
