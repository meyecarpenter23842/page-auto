import { describe, expect, it } from 'vitest'
import { ACTION_REGISTRY, createDefaultActionConfig, validateActionConfig } from './actionRegistry'
import {
  applyK431JoinGroupActionOverrides,
  getK431FieldUiMeta,
  getK431ValidationErrors
} from './k431JoinGroupActionOverrides'

describe('K4.3.1 join group action override', () => {
  it('marks join_group ready with the reference feature set', () => {
    applyK431JoinGroupActionOverrides()
    const definition = ACTION_REGISTRY.find((item) => item.id === 'join_group')
    expect(definition?.runtimeStatus).toBe('ready')
    expect(definition?.configSchema.fields.map((field) => field.key)).toEqual(expect.arrayContaining([
      'sourceMode',
      'sourceTargets',
      'keyword',
      'joinMin',
      'joinMax',
      'answerQuestions',
      'memberFilterEnabled',
      'memberMin',
      'privacyOpen',
      'privacyClosed',
      'skipApprovalRequired',
      'locationEnabled',
      'locationKeyword',
      'localeEnabled',
      'locale',
      'itemDelayMinSeconds',
      'itemDelayMaxSeconds',
      'pauseAfterCount',
      'pauseMinutes'
    ]))
    expect(getK431FieldUiMeta('join_group', 'sourceTargets')?.textFilePickerLabel).toBe('Mở file ID')
  })

  it('uses compact reference defaults and validates conditional sources/filters', () => {
    applyK431JoinGroupActionOverrides()
    const definition = ACTION_REGISTRY.find((item) => item.id === 'join_group')
    expect(definition).toBeTruthy()
    const config = createDefaultActionConfig(definition!)
    expect(config.joinMin).toBe(100)
    expect(config.joinMax).toBe(200)
    expect(config.itemDelayMinSeconds).toBe(200)
    expect(config.itemDelayMaxSeconds).toBe(300)
    expect(config.pauseAfterCount).toBe(30)
    expect(config.pauseMinutes).toBe(15)

    expect(getK431ValidationErrors('join_group', config)).toContain('Group ID / URL: cần nhập danh sách hoặc nạp file ID.')
    const keywordConfig = { ...config, sourceMode: 'keyword', keyword: '' }
    expect(getK431ValidationErrors('join_group', keywordConfig)).toContain('Từ khóa: không được để trống khi chọn nguồn theo từ khóa.')
    expect(getK431ValidationErrors('join_group', { ...config, sourceTargets: '123', privacyOpen: false, privacyClosed: false }))
      .toContain('Privacy: cần chọn ít nhất OPEN hoặc CLOSED.')
  })

  it('stays compatible with base config validation', () => {
    applyK431JoinGroupActionOverrides()
    const result = validateActionConfig('join_group', {
      sourceMode: 'suggestions',
      joinMin: 2,
      joinMax: 4,
      answerQuestions: 'Có\nĐồng ý',
      memberFilterEnabled: true,
      memberMin: 5000,
      privacyOpen: true,
      privacyClosed: true,
      skipApprovalRequired: true,
      locationEnabled: false,
      locationKeyword: '',
      localeEnabled: false,
      locale: '',
      itemDelayMinSeconds: 0,
      itemDelayMaxSeconds: 1,
      pauseAfterCount: 0,
      pauseMinutes: 0,
      sourceTargets: '',
      keyword: ''
    })
    expect(result.valid).toBe(true)
  })
})
