import { describe, expect, it } from 'vitest'
import { ACTION_REGISTRY, createDefaultActionConfig, getActionDefinition, validateActionConfig } from './actionRegistry'
import { applyK41ActionOverrides, getK41ValidationErrors } from './k41ActionOverrides'

describe('K4.1 action overrides', () => {
  it('upgrades the three first view actions with dedicated schemas', () => {
    applyK41ActionOverrides()
    const ready = ACTION_REGISTRY.filter((item) => item.runtimeStatus === 'ready').map((item) => item.id)
    expect(ready).toEqual(expect.arrayContaining(['view_newsfeed', 'view_story', 'view_reel']))
    expect(getActionDefinition('view_newsfeed')?.configSchema.fields.length).toBeGreaterThan(20)
    expect(getActionDefinition('view_story')?.configSchema.fields.length).toBeGreaterThan(10)
    expect(getActionDefinition('view_reel')?.configSchema.fields.length).toBeGreaterThan(15)
  })

  it('validates K4.1 ranges and keeps secret fields out of config', () => {
    applyK41ActionOverrides()
    const definition = getActionDefinition('view_newsfeed')!
    const defaults = createDefaultActionConfig(definition)
    expect(validateActionConfig('view_newsfeed', defaults).valid).toBe(true)
    expect(getK41ValidationErrors('view_newsfeed', { ...defaults, durationMinMinutes: 10, durationMaxMinutes: 5 })).toContain('Thời gian xem: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
    expect(validateActionConfig('view_newsfeed', { ...defaults, cookie: 'x' }).valid).toBe(false)
  })
})
