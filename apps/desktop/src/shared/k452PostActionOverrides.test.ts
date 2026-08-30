import { describe, expect, it } from 'vitest'
import { getActionDefinition, validateActionConfig } from './actionRegistry'
import {
  applyK452PostActionOverrides,
  getK452PostFieldUiMeta,
  getK452PostValidationErrors,
  normalizeK452PostConfig
} from './k452PostActionOverrides'

applyK452PostActionOverrides()

describe('K4.5.2 post action overrides', () => {
  it('keeps one profile-only Đăng bài action with independent Wall and Group targets', () => {
    const definition = getActionDefinition('post')
    expect(definition?.label).toBe('Đăng bài')
    expect(definition?.runtimeStatus).toBe('ready')
    expect(definition?.capabilities.actors).toEqual(['profile'])
    expect(definition?.configSchema.fields.map((field) => field.key)).toEqual([
      'contentSetId',
      'selectionMode',
      'postToWall',
      'wallPostsPerAccount',
      'postToGroups',
      'groupTargets',
      'groupPostsPerAccount',
      'postDelayMinSeconds',
      'postDelayMaxSeconds'
    ])
    expect(getK452PostFieldUiMeta('post', 'groupTargets')?.textFilePickerLabel).toBe('Mở file ID')
    expect(definition?.configSchema.fields.some((field) => field.key === 'wallPageUid')).toBe(false)
  })

  it('migrates the short-lived wall-only config and drops legacy Page UID without losing Group choices', () => {
    expect(normalizeK452PostConfig({
      contentSetId: 10,
      selectionMode: 'random',
      postsPerAccount: 4,
      postDelayMinSeconds: 10,
      postDelayMaxSeconds: 20
    })).toEqual({
      contentSetId: 10,
      selectionMode: 'random',
      postToWall: true,
      wallPostsPerAccount: 4,
      postToGroups: false,
      groupTargets: '',
      groupPostsPerAccount: 1,
      postDelayMinSeconds: 10,
      postDelayMaxSeconds: 20
    })

    expect(normalizeK452PostConfig({
      contentSetId: 11,
      selectionMode: 'sequential',
      postToWall: true,
      wallPageUid: '90001',
      wallPostsPerAccount: 2,
      postToGroups: true,
      groupTargets: 'group-a',
      groupPostsPerAccount: 3,
      postDelayMinSeconds: 0,
      postDelayMaxSeconds: 0
    })).toEqual({
      contentSetId: 11,
      selectionMode: 'sequential',
      postToWall: true,
      wallPostsPerAccount: 2,
      postToGroups: true,
      groupTargets: 'group-a',
      groupPostsPerAccount: 3,
      postDelayMinSeconds: 0,
      postDelayMaxSeconds: 0
    })
  })

  it('accepts Wall-only, Group-only and both-target configs', () => {
    const wall = validateActionConfig('post', normalizeK452PostConfig({
      contentSetId: 20,
      postToWall: true,
      wallPostsPerAccount: 2,
      postToGroups: false
    }))
    expect(wall.valid).toBe(true)
    expect(getK452PostValidationErrors('post', wall.value)).toEqual([])

    const group = validateActionConfig('post', normalizeK452PostConfig({
      contentSetId: 21,
      postToWall: false,
      postToGroups: true,
      groupTargets: '111\nhttps://facebook.com/groups/222',
      groupPostsPerAccount: 3
    }))
    expect(group.valid).toBe(true)
    expect(getK452PostValidationErrors('post', group.value)).toEqual([])

    const both = validateActionConfig('post', normalizeK452PostConfig({
      contentSetId: 22,
      postToWall: true,
      wallPostsPerAccount: 1,
      postToGroups: true,
      groupTargets: '333',
      groupPostsPerAccount: 1
    }))
    expect(both.valid).toBe(true)
    expect(getK452PostValidationErrors('post', both.value)).toEqual([])
  })

  it('rejects no target, missing Group list and inverted delay', () => {
    const base = validateActionConfig('post', normalizeK452PostConfig({
      contentSetId: 12,
      postToWall: false,
      postToGroups: false,
      postDelayMinSeconds: 30,
      postDelayMaxSeconds: 10
    }))
    expect(base.valid).toBe(true)
    expect(getK452PostValidationErrors('post', base.value)).toEqual([
      'Cần bật ít nhất một nơi đăng: Đăng tường hoặc Đăng nhóm.',
      'Delay: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.'
    ])

    const missingGroup = validateActionConfig('post', normalizeK452PostConfig({
      contentSetId: 13,
      postToWall: false,
      postToGroups: true,
      groupTargets: ''
    }))
    expect(missingGroup.valid).toBe(true)
    expect(getK452PostValidationErrors('post', missingGroup.value)).toEqual([
      'Group ID / URL: cần nhập ít nhất một Group khi bật Đăng nhóm.'
    ])
  })
})
