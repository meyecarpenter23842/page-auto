import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTERACTION_WORKSPACE_DRAFT,
  type InteractionWorkspaceDraft
} from '../../shared/interactionWorkspaceConfig'
import {
  allocateInteractionTargets,
  composeInteractionActions,
  interactionWorkspaceActionTypes,
  validateInteractionWorkspaceRun
} from './interactionWorkspaceComposition'

function draft(overrides: Partial<InteractionWorkspaceDraft> = {}): InteractionWorkspaceDraft {
  return {
    ...DEFAULT_INTERACTION_WORKSPACE_DRAFT,
    ...overrides,
    actions: { ...DEFAULT_INTERACTION_WORKSPACE_DRAFT.actions, ...(overrides.actions ?? {}) },
    reactions: { ...DEFAULT_INTERACTION_WORKSPACE_DRAFT.reactions, ...(overrides.reactions ?? {}) }
  }
}

describe('interaction workspace run composition', () => {
  it('freezes UID distribution by account order and limit', () => {
    const config = draft({ targetMode: 'uid_distribute', targetLimit: 2 })
    const targets = ['1', '2', '3', '4', '5', '6']
    expect(allocateInteractionTargets(config, targets, 0, 2)).toEqual(['1', '3'])
    expect(allocateInteractionTargets(config, targets, 1, 2)).toEqual(['2', '4'])
  })

  it('does not create target-required actions for an account with no distributed targets', () => {
    const config = draft({ targetMode: 'uid_distribute', targetValues: '10001', targetLimit: 20 })
    expect(allocateInteractionTargets(config, ['10001'], 1, 2)).toEqual([])
    expect(composeInteractionActions(config, [])).toEqual([])
  })

  it('maps UID reaction/comment to one shared target uid action', () => {
    const config = draft({
      targetMode: 'uid_limit',
      targetValues: '10001\n10002',
      actions: {
        reaction: true,
        comment: true,
        replyComment: false,
        reactComment: false,
        commentTag: false,
        poke: false
      },
      commentTemplates: 'Xin chào'
    })
    expect(validateInteractionWorkspaceRun(config, 1)).toEqual([])
    const actions = composeInteractionActions(config, ['10001', '10002'])
    expect(actions.map((item) => item.actionType)).toEqual(['target_uid_interaction'])
    expect(actions[0]?.config).toMatchObject({
      targets: '10001\n10002',
      reactionEnabled: true,
      commentEnabled: true,
      commentTemplates: 'Xin chào'
    })
  })

  it('prepends Switch Page for Page actor without creating a switch-only turn', () => {
    const config = draft({
      actor: 'page',
      pageUid: '20002',
      targetMode: 'uid_distribute',
      targetValues: '10001'
    })
    expect(interactionWorkspaceActionTypes(config)).toEqual(['switch_page', 'target_uid_interaction'])
    expect(composeInteractionActions(config, ['10001']).map((item) => item.actionType)).toEqual([
      'switch_page',
      'target_uid_interaction'
    ])
    expect(composeInteractionActions(config, [])).toEqual([])
  })

  it('composes group + comment-level actions in stable order', () => {
    const config = draft({
      targetMode: 'groups',
      targetValues: 'https://facebook.com/groups/1',
      actions: {
        reaction: true,
        comment: false,
        replyComment: true,
        reactComment: true,
        commentTag: true,
        poke: false
      },
      replyTemplates: 'Cảm ơn',
      tagTargets: '10001'
    })
    expect(interactionWorkspaceActionTypes(config)).toEqual([
      'group_interaction',
      'react_comment',
      'reply_comment',
      'comment_tag'
    ])
    expect(composeInteractionActions(config, ['https://facebook.com/groups/1']).map((item) => item.actionType)).toEqual([
      'group_interaction',
      'react_comment',
      'reply_comment',
      'comment_tag'
    ])
  })

  it('blocks unsupported placeholder/collector/actor combinations before worker launch', () => {
    const seeding = draft({ targetMode: 'seeding', targetValues: 'post-1' })
    expect(validateInteractionWorkspaceRun(seeding, 1).some((message) => message.includes('executor chưa sẵn sàng'))).toBe(true)

    const requests = draft({ targetMode: 'friend_requests' })
    expect(validateInteractionWorkspaceRun(requests, 1).some((message) => message.includes('target collector'))).toBe(true)

    const pagePoke = draft({
      actor: 'page',
      pageUid: '123',
      actions: {
        reaction: false,
        comment: false,
        replyComment: false,
        reactComment: false,
        commentTag: false,
        poke: true
      }
    })
    expect(validateInteractionWorkspaceRun(pagePoke, 1).some((message) => message.includes('không hỗ trợ actor Page'))).toBe(true)
  })
})
