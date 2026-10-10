import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultActionConfig, getActionDefinition, validateActionConfig } from './actionRegistry'
import { applyK454StoryPostActionOverrides, getK454StoryValidationErrors } from './k454StoryPostActionOverrides'

describe('K4.5.4 Story action overrides', () => {
  beforeEach(() => applyK454StoryPostActionOverrides())

  it('turns post_story into a profile runtime action with reusable Story references', () => {
    const definition = getActionDefinition('post_story')!
    expect(definition.runtimeStatus).toBe('ready')
    expect(definition.capabilities.actors).toEqual(['profile'])
    expect(definition.configSchema.fields.map((field) => field.key)).toContain('storyIds')

    const config = { ...createDefaultActionConfig(definition), storyIds: '1,2' }
    expect(validateActionConfig('post_story', config).valid).toBe(true)
    expect(getK454StoryValidationErrors('post_story', config)).toEqual([])
  })

  it('rejects empty Story selection and inverted delay', () => {
    const definition = getActionDefinition('post_story')!
    const config = {
      ...createDefaultActionConfig(definition),
      storyIds: '',
      delayMinSeconds: 120,
      delayMaxSeconds: 60
    }
    expect(getK454StoryValidationErrors('post_story', config)).toEqual(expect.arrayContaining([
      expect.stringContaining('ít nhất một Story'),
      expect.stringContaining('giá trị “đến”')
    ]))
  })
})
