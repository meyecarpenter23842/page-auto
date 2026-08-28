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
    expect(ACTION_REGISTRY).toHaveLength(39)
    expect(ACTION_CATEGORIES.map((category) => ACTION_REGISTRY.filter((item) => item.category === category.id).length)).toEqual([10, 7, 5, 4, 5, 8])
    expect(new Set(ACTION_REGISTRY.map((item) => item.id)).size).toBe(ACTION_REGISTRY.length)
    expect(getActionDefinition('group_post')).toMatchObject({ category: 'groups', label: 'Đăng bài nhóm' })
    expect(getActionDefinition('birthday_greeting')).toBeUndefined()
    expect(ACTION_REGISTRY.every((item) => item.runtimeStatus === 'placeholder')).toBe(true)
  })

  it('keeps the result contract stable for the future common runner', () => {
    expect(ACTION_RESULT_STATUSES).toEqual(['success', 'skipped', 'needs_attention', 'failed', 'stopped'])
  })

  it('builds defaults and validates typed config without allowing secrets or unknown fields', () => {
    const view = getActionDefinition('view_newsfeed')!
    expect(createDefaultActionConfig(view)).toEqual({ durationSeconds: 15 })
    expect(validateActionConfig('view_newsfeed', {})).toEqual({ valid: true, value: { durationSeconds: 15 }, errors: [] })
    expect(validateActionConfig('facebook_search', { keyword: 'page auto' }).valid).toBe(true)
    expect(validateActionConfig('facebook_search', {}).valid).toBe(false)
    expect(validateActionConfig('view_newsfeed', { cookie: 'x' }).valid).toBe(false)
    expect(validateActionConfig('view_newsfeed', { unknown: true }).valid).toBe(false)
  })
})
