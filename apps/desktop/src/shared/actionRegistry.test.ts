import { describe, expect, it } from 'vitest'
import {
  ACTION_CATEGORIES,
  ACTION_REGISTRY,
  ACTION_RESULT_STATUSES,
  createDefaultActionConfig,
  getActionDefinition,
  validateActionConfig
} from './actionRegistry'

describe('actionRegistry', () => {
  it('contains the active catalog in six groups with stable unique ids', () => {
    expect(ACTION_CATEGORIES.map((item) => item.id)).toEqual([
      'interaction', 'friends', 'groups', 'marketplace', 'publishing', 'other'
    ])
    expect(ACTION_REGISTRY).toHaveLength(44)
    expect(ACTION_CATEGORIES.map((category) => ACTION_REGISTRY.filter((item) => item.category === category.id).length)).toEqual([14, 7, 5, 4, 5, 9])
    expect(new Set(ACTION_REGISTRY.map((item) => item.id)).size).toBe(ACTION_REGISTRY.length)
    expect(getActionDefinition('group_post')).toMatchObject({ category: 'groups', label: 'Đăng bài nhóm' })
    expect(getActionDefinition('react_comment')).toMatchObject({ category: 'interaction', label: 'Thả cảm xúc comment' })
    expect(getActionDefinition('reply_comment')).toMatchObject({ category: 'interaction', label: 'Trả lời comment' })
    expect(getActionDefinition('comment_tag')).toMatchObject({ category: 'interaction', label: 'Comment tag' })
    expect(getActionDefinition('target_uid_interaction')).toMatchObject({ category: 'interaction', label: 'Tương tác theo UID' })
    expect(getActionDefinition('switch_page')).toMatchObject({
      category: 'other',
      label: 'Switch Page',
      capabilities: { actors: ['page'], requiresNavigation: false }
    })
    expect(getActionDefinition('birthday_greeting')).toBeUndefined()
    expect(ACTION_REGISTRY.every((item) => item.runtimeStatus === 'placeholder')).toBe(true)
  })

  it('keeps the result contract stable for the future common runner', () => {
    expect(ACTION_RESULT_STATUSES).toEqual(['success', 'skipped', 'needs_attention', 'failed', 'stopped'])
  })

  it('builds defaults and validates typed config by the declared schema', () => {
    const view = getActionDefinition('view_newsfeed')!
    expect(createDefaultActionConfig(view)).toEqual({ durationSeconds: 15 })
    expect(validateActionConfig('view_newsfeed', {})).toEqual({ valid: true, value: { durationSeconds: 15 }, errors: [] })
    expect(validateActionConfig('facebook_search', { keyword: 'page auto' }).valid).toBe(true)
    expect(validateActionConfig('facebook_search', {}).valid).toBe(false)
    expect(validateActionConfig('view_newsfeed', { cookie: 'x' }).valid).toBe(false)
    expect(validateActionConfig('view_newsfeed', { unknown: true }).valid).toBe(false)
  })

  it('allows a token field when the action schema explicitly declares it', () => {
    const copyPost = getActionDefinition('copy_post')!
    const originalSchema = copyPost.configSchema

    try {
      copyPost.configSchema = {
        version: 1,
        fields: [{ key: 'token', label: 'Token quét', kind: 'text', required: true }]
      }
      expect(validateActionConfig('copy_post', { token: 'test-token' })).toEqual({
        valid: true,
        value: { token: 'test-token' },
        errors: []
      })
    } finally {
      copyPost.configSchema = originalSchema
    }
  })
})
