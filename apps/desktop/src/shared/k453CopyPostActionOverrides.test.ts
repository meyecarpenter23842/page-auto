import { describe, expect, it } from 'vitest'
import { createDefaultActionConfig, getActionDefinition, validateActionConfig } from './actionRegistry'
import { applyK453CopyPostActionOverrides, getK453CopyPostValidationErrors } from './k453CopyPostActionOverrides'

applyK453CopyPostActionOverrides()

describe('K4.5.3 copy_post config', () => {
  it('keeps the Graph token out of persisted action config while declaring source/filter fields', () => {
    const definition = getActionDefinition('copy_post')!
    const defaults = createDefaultActionConfig(definition)
    expect(definition.configSchema.fields.some((field) => field.key === 'token')).toBe(false)
    expect(defaults).toMatchObject({
      limit: 50,
      randomCount: 0,
      includeStatus: true,
      includePhoto: true,
      includeVideo: true,
      includeReel: true,
      includeLink: true,
      skipCopied: true,
      mediaFolder: ''
    })
    const result = validateActionConfig('copy_post', { ...defaults, sourcesText: '123' })
    expect(result.valid).toBe(true)
    if (result.valid) expect(getK453CopyPostValidationErrors('copy_post', result.value)).toEqual([])
  })

  it('requires a source and at least one selected post type', () => {
    const definition = getActionDefinition('copy_post')!
    const config = {
      ...createDefaultActionConfig(definition),
      sourcesText: '123',
      includeStatus: false,
      includePhoto: false,
      includeVideo: false,
      includeReel: false,
      includeLink: false
    }
    const result = validateActionConfig('copy_post', config)
    expect(result.valid).toBe(true)
    if (result.valid) expect(getK453CopyPostValidationErrors('copy_post', result.value)).toContain('Loại bài: cần chọn ít nhất một loại bài.')
  })
})
