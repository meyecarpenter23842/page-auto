import { describe, expect, it } from 'vitest'
import { ACTION_REGISTRY, createDefaultActionConfig, validateActionConfig } from './actionRegistry'
import {
  applyK432InviteFriendsGroupActionOverrides,
  getK432FieldUiMeta,
  getK432ValidationErrors
} from './k432InviteFriendsGroupActionOverrides'

describe('K4.3.2 invite friends to group action override', () => {
  it('marks invite_friends_to_group ready with the reference feature set', () => {
    applyK432InviteFriendsGroupActionOverrides()
    const definition = ACTION_REGISTRY.find((item) => item.id === 'invite_friends_to_group')
    expect(definition?.runtimeStatus).toBe('ready')
    expect(definition?.configSchema.fields.map((field) => field.key)).toEqual(expect.arrayContaining([
      'groupTargets',
      'inviteMin',
      'inviteMax',
      'invitePerBatch',
      'itemDelayMinSeconds',
      'itemDelayMaxSeconds',
      'pauseAfterCount',
      'pauseMinutes'
    ]))
    expect(getK432FieldUiMeta('invite_friends_to_group', 'groupTargets')).toMatchObject({
      section: 'Nhóm đích',
      multiline: true,
      rows: 6
    })
  })

  it('uses the compact reference defaults and validates ranges/source', () => {
    applyK432InviteFriendsGroupActionOverrides()
    const definition = ACTION_REGISTRY.find((item) => item.id === 'invite_friends_to_group')
    expect(definition).toBeTruthy()
    const config = createDefaultActionConfig(definition!)
    expect(config.inviteMin).toBe(100)
    expect(config.inviteMax).toBe(200)
    expect(config.invitePerBatch).toBe(7)
    expect(config.itemDelayMinSeconds).toBe(200)
    expect(config.itemDelayMaxSeconds).toBe(300)
    expect(config.pauseAfterCount).toBe(30)
    expect(config.pauseMinutes).toBe(15)

    expect(getK432ValidationErrors('invite_friends_to_group', config))
      .toContain('ID nhóm muốn mời bạn bè: không được để trống.')
    expect(getK432ValidationErrors('invite_friends_to_group', { ...config, groupTargets: '123', inviteMin: 20, inviteMax: 10 }))
      .toContain('Số bạn bè muốn mời: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
    expect(getK432ValidationErrors('invite_friends_to_group', { ...config, groupTargets: '123', itemDelayMinSeconds: 300, itemDelayMaxSeconds: 200 }))
      .toContain('Delay: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
  })

  it('stays compatible with base config validation', () => {
    applyK432InviteFriendsGroupActionOverrides()
    const result = validateActionConfig('invite_friends_to_group', {
      groupTargets: '123\nhttps://www.facebook.com/groups/456/',
      inviteMin: 2,
      inviteMax: 4,
      invitePerBatch: 2,
      itemDelayMinSeconds: 0,
      itemDelayMaxSeconds: 1,
      pauseAfterCount: 0,
      pauseMinutes: 0
    })
    expect(result.valid).toBe(true)
  })
})
