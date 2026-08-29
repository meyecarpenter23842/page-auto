import { describe, expect, it } from 'vitest'
import { getActionDefinition, validateActionConfig } from './actionRegistry'
import {
  applyK452PostActionOverrides,
  getK452PostFieldUiMeta,
  getK452PostValidationErrors
} from './k452PostActionOverrides'

applyK452PostActionOverrides()

describe('K4.5.2 post action overrides', () => {
  it('marks post ready with Content Library and independent target config', () => {
    const definition = getActionDefinition('post')
    expect(definition?.runtimeStatus).toBe('ready')
    expect(definition?.configSchema.fields.map((field) => field.key)).toEqual([
      'contentSetId',
      'selectionMode',
      'postToWall',
      'wallPageUid',
      'wallPostsPerAccount',
      'postToGroups',
      'groupTargets',
      'groupPostsPerAccount',
      'postDelayMinSeconds',
      'postDelayMaxSeconds'
    ])
    expect(getK452PostFieldUiMeta('post', 'groupTargets')?.textFilePickerLabel).toBe('Mở file ID')
  })

  it('accepts Wall-only and Group-only configs', () => {
    const wall = validateActionConfig('post', {
      contentSetId: 10,
      selectionMode: 'sequential',
      postToWall: true,
      wallPageUid: '123456',
      wallPostsPerAccount: 2,
      postToGroups: false,
      groupTargets: '',
      groupPostsPerAccount: 1,
      postDelayMinSeconds: 10,
      postDelayMaxSeconds: 20
    })
    expect(wall.valid).toBe(true)
    expect(getK452PostValidationErrors('post', wall.value)).toEqual([])

    const group = validateActionConfig('post', {
      contentSetId: 11,
      selectionMode: 'random',
      postToWall: false,
      wallPageUid: '',
      wallPostsPerAccount: 1,
      postToGroups: true,
      groupTargets: '111\nhttps://facebook.com/groups/222',
      groupPostsPerAccount: 3,
      postDelayMinSeconds: 0,
      postDelayMaxSeconds: 0
    })
    expect(group.valid).toBe(true)
    expect(getK452PostValidationErrors('post', group.value)).toEqual([])
  })

  it('rejects missing targets, conditional target config and inverted delay', () => {
    const base = validateActionConfig('post', {
      contentSetId: 12,
      selectionMode: 'sequential',
      postToWall: true,
      wallPageUid: '',
      wallPostsPerAccount: 1,
      postToGroups: true,
      groupTargets: '',
      groupPostsPerAccount: 1,
      postDelayMinSeconds: 30,
      postDelayMaxSeconds: 10
    })
    expect(base.valid).toBe(true)
    expect(getK452PostValidationErrors('post', base.value)).toEqual([
      'Page UID: không được để trống khi bật Đăng tường.',
      'Group ID / URL: cần nhập ít nhất một Group khi bật Đăng nhóm.',
      'Delay: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.'
    ])
  })
})
