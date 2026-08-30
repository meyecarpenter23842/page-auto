import { describe, expect, it } from 'vitest'
import { getActionDefinition, validateActionConfig } from './actionRegistry'
import {
  applyK452PostActionOverrides,
  getK452PostValidationErrors,
  normalizeK452PostConfig
} from './k452PostActionOverrides'

applyK452PostActionOverrides()

describe('K4.5.2 post action overrides', () => {
  it('defines post as a profile-only wall action instead of a Page/Group composite', () => {
    const definition = getActionDefinition('post')
    expect(definition?.label).toBe('Đăng tường')
    expect(definition?.runtimeStatus).toBe('ready')
    expect(definition?.capabilities.actors).toEqual(['profile'])
    expect(definition?.configSchema.fields.map((field) => field.key)).toEqual([
      'contentSetId',
      'selectionMode',
      'postsPerAccount',
      'postDelayMinSeconds',
      'postDelayMaxSeconds'
    ])
  })

  it('normalizes the old composite config without carrying Page or Group destinations forward', () => {
    expect(normalizeK452PostConfig({
      contentSetId: 10,
      selectionMode: 'random',
      postToWall: true,
      wallPageUid: '90001',
      wallPostsPerAccount: 4,
      postToGroups: true,
      groupTargets: '80001',
      groupPostsPerAccount: 3,
      postDelayMinSeconds: 10,
      postDelayMaxSeconds: 20
    })).toEqual({
      contentSetId: 10,
      selectionMode: 'random',
      postsPerAccount: 4,
      postDelayMinSeconds: 10,
      postDelayMaxSeconds: 20
    })
  })

  it('accepts a normal account-wall config and rejects inverted delay', () => {
    const valid = validateActionConfig('post', {
      contentSetId: 11,
      selectionMode: 'sequential',
      postsPerAccount: 2,
      postDelayMinSeconds: 10,
      postDelayMaxSeconds: 20
    })
    expect(valid.valid).toBe(true)
    expect(getK452PostValidationErrors('post', valid.value)).toEqual([])

    const invalid = validateActionConfig('post', {
      contentSetId: 12,
      selectionMode: 'sequential',
      postsPerAccount: 1,
      postDelayMinSeconds: 30,
      postDelayMaxSeconds: 10
    })
    expect(invalid.valid).toBe(true)
    expect(getK452PostValidationErrors('post', invalid.value)).toEqual([
      'Delay: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.'
    ])
  })
})
