import { describe, expect, it } from 'vitest'
import { ACTION_REGISTRY, createDefaultActionConfig, validateActionConfig } from './actionRegistry'
import {
  applyK434LeaveGroupActionOverrides,
  getK434FieldUiMeta,
  getK434ValidationErrors
} from './k434LeaveGroupActionOverrides'

describe('K4.3.4 leave group action override', () => {
  it('marks leave_group ready with source, amount and pacing fields', () => {
    applyK434LeaveGroupActionOverrides()
    const definition = ACTION_REGISTRY.find((item) => item.id === 'leave_group')
    expect(definition?.runtimeStatus).toBe('ready')
    const keys = definition?.configSchema.fields.map((field) => field.key) ?? []
    expect(keys).toEqual(expect.arrayContaining([
      'sourceMode',
      'sourceTargets',
      'leaveMin',
      'leaveMax',
      'itemDelayMinSeconds',
      'itemDelayMaxSeconds',
      'pauseAfterCount',
      'pauseMinutes'
    ]))
    expect(getK434FieldUiMeta('leave_group', 'sourceTargets')).toMatchObject({
      section: 'Nguồn nhóm',
      multiline: true,
      visibleWhen: { key: 'sourceMode', equals: 'id_list' }
    })
  })

  it('uses safe defaults and validates ranges and ID-list dependency', () => {
    applyK434LeaveGroupActionOverrides()
    const definition = ACTION_REGISTRY.find((item) => item.id === 'leave_group')!
    const config = createDefaultActionConfig(definition)
    expect(config.sourceMode).toBe('id_list')
    expect(config.leaveMin).toBe(1)
    expect(config.leaveMax).toBe(3)
    expect(config.itemDelayMinSeconds).toBe(60)
    expect(config.itemDelayMaxSeconds).toBe(180)

    expect(getK434ValidationErrors('leave_group', { ...config, leaveMin: 4, leaveMax: 2 }))
      .toContain('Số nhóm muốn rời: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
    expect(getK434ValidationErrors('leave_group', {
      ...config,
      sourceMode: 'id_list',
      sourceTargets: ''
    })).toContain('Group ID / URL: cần nhập danh sách hoặc nạp file ID.')
  })

  it('stays compatible with base config validation', () => {
    applyK434LeaveGroupActionOverrides()
    const definition = ACTION_REGISTRY.find((item) => item.id === 'leave_group')!
    expect(validateActionConfig('leave_group', createDefaultActionConfig(definition)).valid).toBe(true)
  })
})
