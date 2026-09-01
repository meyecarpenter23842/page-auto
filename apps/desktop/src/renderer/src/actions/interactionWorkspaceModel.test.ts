import { describe, expect, it } from 'vitest'
import {
  buildInteractionWorkspacePlan,
  DEFAULT_INTERACTION_WORKSPACE_DRAFT,
  parseInteractionWorkspaceDraft,
  serializeInteractionWorkspaceDraft,
  type InteractionWorkspaceDraft
} from './interactionWorkspaceModel'

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

  it('adds the common Switch Page module first when Page actor is enabled', () => {
    const plan = buildInteractionWorkspacePlan(draft({
      actor: 'page',
      pageUid: '987654321',
      targetMode: 'uid_limit',
      targetValues: '10001'
    }))
    expect(plan.modules.map((module) => module.actionType)).toEqual(['switch_page', 'target_uid_interaction'])
    expect(plan.modules[0]).toMatchObject({ label: 'Switch Page', runtimeStatus: 'ready' })
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

  it('keeps placeholder modules visible and blocks missing target adapters', () => {
    const seeding = buildInteractionWorkspacePlan(draft({ targetMode: 'seeding', targetValues: 'post-01' }))
    expect(seeding.modules[0]).toMatchObject({ actionType: 'like_comment_seeding', runtimeStatus: 'placeholder' })
    expect(seeding.warnings.some((message) => message.includes('chưa có executor'))).toBe(true)

    const friendRequest = buildInteractionWorkspacePlan(draft({ targetMode: 'friend_requests' }))
    expect(friendRequest.errors.some((message) => message.includes('target collector'))).toBe(true)
  })

  it('validates conditional config, Page UID and actor compatibility', () => {
    const missingPage = buildInteractionWorkspacePlan(draft({ actor: 'page' }))
    expect(missingPage.errors).toContain('Actor Page cần nhập Page UID.')

    const plan = buildInteractionWorkspacePlan(draft({
      actor: 'page',
      pageUid: '123456',
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
    expect(plan.errors.some((message) => message.includes('không hỗ trợ actor Page'))).toBe(true)
  })

  it('round-trips persisted workspace config and safely fills missing fields', () => {
    const source = draft({
      actor: 'page',
      pageUid: '987654321',
      targetMode: 'uid_limit',
      targetValues: '10001|10002',
      delayMinSeconds: 7,
      delayMaxSeconds: 12,
      actions: { ...DEFAULT_INTERACTION_WORKSPACE_DRAFT.actions, comment: true },
      commentTemplates: 'Xin chào'
    })
    expect(parseInteractionWorkspaceDraft(serializeInteractionWorkspaceDraft(source))).toEqual(source)

    const legacy = parseInteractionWorkspaceDraft(JSON.stringify({ targetMode: 'groups', targetValues: '123' }))
    expect(legacy.targetMode).toBe('groups')
    expect(legacy.pageUid).toBe('')
    expect(legacy.actions).toEqual(DEFAULT_INTERACTION_WORKSPACE_DRAFT.actions)
    expect(legacy.reactions).toEqual(DEFAULT_INTERACTION_WORKSPACE_DRAFT.reactions)
  })

  it('falls back to defaults for corrupt or invalid persisted values', () => {
    expect(parseInteractionWorkspaceDraft('{')).toEqual(DEFAULT_INTERACTION_WORKSPACE_DRAFT)
    const parsed = parseInteractionWorkspaceDraft(JSON.stringify({
      actor: 'invalid',
      targetMode: 'invalid',
      targetLimit: -1,
      delayMinSeconds: -2,
      actions: { reaction: 'yes' }
    }))
    expect(parsed.actor).toBe('profile')
    expect(parsed.targetMode).toBe('friends')
    expect(parsed.targetLimit).toBe(DEFAULT_INTERACTION_WORKSPACE_DRAFT.targetLimit)
    expect(parsed.delayMinSeconds).toBe(DEFAULT_INTERACTION_WORKSPACE_DRAFT.delayMinSeconds)
    expect(parsed.actions.reaction).toBe(true)
  })
})
