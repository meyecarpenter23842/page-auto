import { describe, expect, it } from 'vitest'
import type { ActionExecutorContext } from '../../../services/actionRunner'
import { createK42FriendActionExecutorRegistry } from './index'
import { ReactCommentActionExecutor } from './reactCommentAction'
import { ReplyCommentActionExecutor } from './replyCommentAction'
import { CommentTagActionExecutor } from './commentTagAction'
import { TargetUidInteractionActionExecutor } from './targetUidInteractionAction'

const unavailable = { resolvePage: async () => null }

function dependencies() {
  return {
    friendInteraction: unavailable,
    pokeFriend: unavailable,
    sendFriendRequest: unavailable,
    acceptFriendRequest: unavailable,
    cancelSentFriendRequests: unavailable,
    unfriend: unavailable,
    friendFromEngagement: unavailable
  }
}

describe('interaction atomic action executors', () => {
  it('registers all four audited modules in the shared executor registry', () => {
    const registry = createK42FriendActionExecutorRegistry(dependencies())
    expect(registry.has('react_comment')).toBe(true)
    expect(registry.has('reply_comment')).toBe(true)
    expect(registry.has('comment_tag')).toBe(true)
    expect(registry.has('target_uid_interaction')).toBe(true)
  })

  it('keeps each atomic executor independent and returns typed browser failures', async () => {
    const context = { request: {} } as unknown as ActionExecutorContext
    const executors = [
      new ReactCommentActionExecutor(unavailable),
      new ReplyCommentActionExecutor(unavailable),
      new CommentTagActionExecutor(unavailable),
      new TargetUidInteractionActionExecutor(unavailable)
    ]

    expect(executors.map((executor) => executor.actionType)).toEqual([
      'react_comment',
      'reply_comment',
      'comment_tag',
      'target_uid_interaction'
    ])

    for (const executor of executors) {
      const result = await executor.execute(context, {})
      expect(result).toMatchObject({ status: 'failed', code: 'browser_unavailable' })
    }
  })
})
