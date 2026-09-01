import { describe, expect, it } from 'vitest'
import { ACTION_REGISTRY, createDefaultActionConfig } from './actionRegistry'
import { applyK431JoinGroupActionOverrides, getK431ValidationErrors } from './k431JoinGroupActionOverrides'

describe('K4.3.1 join group workspace fields', () => {
  it('exposes real member upper bound and error-pause fields to join_group', () => {
    applyK431JoinGroupActionOverrides()
    const definition = ACTION_REGISTRY.find((item) => item.id === 'join_group')
    expect(definition).toBeTruthy()
    const config = createDefaultActionConfig(definition!)
    expect(config.memberMax).toBe(0)
    expect(config.errorPauseMinutes).toBe(0)
  })

  it('validates an enabled member range before runtime', () => {
    applyK431JoinGroupActionOverrides()
    expect(getK431ValidationErrors('join_group', {
      sourceMode: 'id_list',
      sourceTargets: '123',
      joinMin: 1,
      joinMax: 1,
      memberFilterEnabled: true,
      memberMin: 50_000,
      memberMax: 10_000,
      privacyOpen: true,
      privacyClosed: true,
      itemDelayMinSeconds: 0,
      itemDelayMaxSeconds: 0
    })).toContain('Số thành viên: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
  })
})
