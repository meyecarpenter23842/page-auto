import { describe, expect, it } from 'vitest'
import { createK42FriendActionExecutorRegistry } from './index'
import { friendInteractionResult } from './friendInteractionAction'
import { pokeFriendResult } from './pokeFriendAction'

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

  it('does not report friend interaction success when no configured action was verified', () => {
    expect(friendInteractionResult(
      { liked: 0, commented: 0, avatarLiked: 0 },
      { likes: 2, comments: 1, avatarLikes: 0 }
    )).toMatchObject({ status: 'skipped', code: 'friend_interaction_no_verified_action' })

    expect(friendInteractionResult(
      { liked: 1, commented: 0, avatarLiked: 0 },
      { likes: 2, comments: 0, avatarLikes: 0 }
    )).toMatchObject({ status: 'failed', code: 'friend_interaction_incomplete' })

    expect(friendInteractionResult(
      { liked: 2, commented: 1, avatarLiked: 0 },
      { likes: 2, comments: 1, avatarLikes: 0 }
    )).toMatchObject({ status: 'success', code: 'friend_interaction_completed' })
  })

  it('does not report poke success when no Poke control was actually clicked', () => {
    expect(pokeFriendResult(0, 0, 3, 0)).toMatchObject({
      status: 'skipped',
      code: 'poke_friend_no_verified_action'
    })
    expect(pokeFriendResult(1, 0, 3, 0)).toMatchObject({
      status: 'failed',
      code: 'poke_friend_incomplete'
    })
    expect(pokeFriendResult(3, 0, 3, 0)).toMatchObject({
      status: 'success',
      code: 'poke_friend_completed'
    })
  })
})
