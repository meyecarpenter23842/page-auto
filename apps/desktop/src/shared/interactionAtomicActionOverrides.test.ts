import { describe, expect, it } from 'vitest'
import { ACTION_REGISTRY, getActionDefinition } from './actionRegistry'
import {
  applyInteractionAtomicActionOverrides,
  getInteractionAtomicValidationErrors
} from './interactionAtomicActionOverrides'

describe('interaction atomic action overrides', () => {
  it('marks the four audited interaction modules ready with config schemas', () => {
    applyInteractionAtomicActionOverrides()
    const ids = ['react_comment', 'reply_comment', 'comment_tag', 'target_uid_interaction']
    const actions = ids.map((id) => getActionDefinition(id))

    expect(actions.every(Boolean)).toBe(true)
    expect(actions.every((item) => item?.runtimeStatus === 'ready')).toBe(true)
    expect(actions.every((item) => (item?.configSchema.fields.length ?? 0) > 0)).toBe(true)
    expect(ACTION_REGISTRY.filter((item) => ids.includes(item.id))).toHaveLength(4)
  })

  it('validates reaction, reply, tag and UID interaction requirements', () => {
    expect(getInteractionAtomicValidationErrors('react_comment', {
      reactionLike: false,
      reactionLove: false,
      reactionCare: false,
      reactionHaha: false,
      reactionWow: false,
      reactionSad: false,
      reactionAngry: false,
      itemDelayMinSeconds: 0,
      itemDelayMaxSeconds: 0
    })).toContain('Cảm xúc: cần chọn ít nhất một loại.')

    expect(getInteractionAtomicValidationErrors('reply_comment', {
      replyTemplates: '',
      itemDelayMinSeconds: 0,
      itemDelayMaxSeconds: 0
    })).toContain('Nội dung trả lời: không được để trống.')

    expect(getInteractionAtomicValidationErrors('comment_tag', {
      tagTargets: '',
      itemDelayMinSeconds: 0,
      itemDelayMaxSeconds: 0
    })).toContain('Tên / UID cần tag: không được để trống.')

    expect(getInteractionAtomicValidationErrors('target_uid_interaction', {
      targets: '',
      reactionEnabled: false,
      commentEnabled: false,
      itemDelayMinSeconds: 0,
      itemDelayMaxSeconds: 0
    })).toEqual(expect.arrayContaining([
      'Danh sách UID / URL: không được để trống.',
      'Tương tác theo UID: cần bật Reaction hoặc Comment.'
    ]))
  })
})
