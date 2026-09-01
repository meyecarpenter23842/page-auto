import { describe, expect, it } from 'vitest'
import { buildInteractionWorkspacePlan, DEFAULT_INTERACTION_WORKSPACE_DRAFT, type InteractionWorkspaceDraft } from './interactionWorkspaceModel'

function draft(overrides: Partial<InteractionWorkspaceDraft> = {}): InteractionWorkspaceDraft {
  return {
    ...DEFAULT_INTERACTION_WORKSPACE_DRAFT,
    ...overrides,
    actions: { ...DEFAULT_INTERACTION_WORKSPACE_DRAFT.actions, ...(overrides.actions ?? {}) },
    reactions: { ...DEFAULT_INTERACTION_WORKSPACE_DRAFT.reactions, ...(overrides.reactions ?? {}) }
  }
}

describe('interaction workspace composition model', () => {
  it('maps UID reaction/comment to the shared target UID module', () => {
    const plan = buildInteractionWorkspacePlan(draft({ targetMode: 'uid_distribute', targetValues: '10001\n10002' }))
    expect(plan.modules.map((module) => module.actionType)).toEqual(['target_uid_interaction'])
    expect(plan.modules[0]?.runtimeStatus).toBe('ready')
  })

  it('composes the four atomic comment modules without duplicating target drivers', () => {
    const plan = buildInteractionWorkspacePlan(draft({
      targetMode: 'groups',
      targetValues: 'https://www.facebook.com/groups/123',
      actions: {
        reaction: true,
        comment: false,
        replyComment: true,
        reactComment: true,
        commentTag: true,
        poke: false
      },
      replyTemplates: 'Cảm ơn bạn',
      tagTargets: 'Nguyễn Văn A'
    }))
    expect(plan.modules.map((module) => module.actionType)).toEqual(['group_interaction', 'react_comment', 'reply_comment', 'comment_tag'])
    expect(plan.modules.every((module) => module.runtimeStatus === 'ready')).toBe(true)
  })

  it('keeps placeholder modules visible and explains missing target adapters', () => {
    const seeding = buildInteractionWorkspacePlan(draft({ targetMode: 'seeding', targetValues: 'post-01' }))
    expect(seeding.modules[0]).toMatchObject({ actionType: 'like_comment_seeding', runtimeStatus: 'placeholder' })
    expect(seeding.warnings.some((message) => message.includes('chưa có executor'))).toBe(true)

    const friendRequest = buildInteractionWorkspacePlan(draft({ targetMode: 'friend_requests' }))
    expect(friendRequest.warnings.some((message) => message.includes('target collector'))).toBe(true)
  })

  it('validates conditional config and actor compatibility', () => {
    const plan = buildInteractionWorkspacePlan(draft({
      actor: 'page',
      actions: {
        reaction: true,
        comment: true,
        replyComment: false,
        reactComment: false,
        commentTag: false,
        poke: true
      },
      commentTemplates: ''
    }))
    expect(plan.errors).toContain('Comment đang bật nhưng chưa có nội dung.')
    expect(plan.warnings.some((message) => message.includes('không hỗ trợ actor Page'))).toBe(true)
  })
})
