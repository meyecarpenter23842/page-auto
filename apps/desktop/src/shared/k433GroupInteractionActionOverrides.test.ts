import { describe, expect, it } from 'vitest'
import { ACTION_REGISTRY, createDefaultActionConfig, validateActionConfig } from './actionRegistry'
import {
  applyK433GroupInteractionActionOverrides,
  getK433FieldUiMeta,
  getK433ValidationErrors
} from './k433GroupInteractionActionOverrides'

describe('K4.3.3 group interaction action override', () => {
  it('marks group_interaction ready with group-feed interaction fields and no anti-detection config', () => {
    applyK433GroupInteractionActionOverrides()
    const definition = ACTION_REGISTRY.find((item) => item.id === 'group_interaction')
    expect(definition?.runtimeStatus).toBe('ready')
    expect(definition?.capabilities.supportsMedia).toBe(true)
    const keys = definition?.configSchema.fields.map((field) => field.key) ?? []
    expect(keys).toEqual(expect.arrayContaining([
      'sourceMode',
      'joinedGroupMin',
      'joinedGroupMax',
      'groupWhitelist',
      'viewEnabled',
      'viewMinSeconds',
      'viewMaxSeconds',
      'sortRecent',
      'reactionEnabled',
      'commentEnabled',
      'deleteCommentAfter',
      'usePostTextAsComment',
      'commentTemplates',
      'commentImagePath',
      'shareWallEnabled',
      'shareGroupEnabled',
      'shareGroupWhitelist',
      'restrictedGroupPolicy',
      'itemDelayMinSeconds',
      'itemDelayMaxSeconds'
    ]))
    expect(keys.some((key) => /md5|anti|fingerprint|stealth/i.test(key))).toBe(false)
    expect(getK433FieldUiMeta('group_interaction', 'groupWhitelist')).toMatchObject({
      section: 'Nguồn nhóm',
      multiline: true
    })
  })

  it('uses the reference defaults and validates dependent options and ranges', () => {
    applyK433GroupInteractionActionOverrides()
    const definition = ACTION_REGISTRY.find((item) => item.id === 'group_interaction')
    expect(definition).toBeTruthy()
    const config = createDefaultActionConfig(definition!)
    expect(config.sourceMode).toBe('groups_feed')
    expect(config.joinedGroupMin).toBe(5)
    expect(config.joinedGroupMax).toBe(10)
    expect(config.viewEnabled).toBe(true)
    expect(config.viewMinSeconds).toBe(1)
    expect(config.viewMaxSeconds).toBe(5)
    expect(config.reactionEnabled).toBe(true)
    expect(config.reactionLike).toBe(true)
    expect(config.itemDelayMinSeconds).toBe(60)
    expect(config.itemDelayMaxSeconds).toBe(240)

    expect(getK433ValidationErrors('group_interaction', { ...config, reactionMin: 4, reactionMax: 2 }))
      .toContain('Số cảm xúc: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
    expect(getK433ValidationErrors('group_interaction', {
      ...config,
      commentEnabled: true,
      usePostTextAsComment: false,
      commentTemplates: ''
    })).toContain('Nội dung comment: cần nhập nội dung hoặc bật lấy nội dung từ bài viết.')
    expect(getK433ValidationErrors('group_interaction', {
      ...config,
      shareGroupEnabled: true,
      shareGroupWhitelist: ''
    })).toContain('Whitelist nhóm đích khi chia sẻ: không được để trống khi bật chia sẻ lên nhóm.')
  })

  it('stays compatible with base config validation', () => {
    applyK433GroupInteractionActionOverrides()
    const definition = ACTION_REGISTRY.find((item) => item.id === 'group_interaction')!
    const result = validateActionConfig('group_interaction', createDefaultActionConfig(definition))
    expect(result.valid).toBe(true)
  })
})
