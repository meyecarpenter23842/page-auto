import { describe, expect, it } from 'vitest'
import { ACTION_REGISTRY } from './actionRegistry'
import { applyK42FriendActionOverrides, getK42ValidationErrors } from './k42FriendActionOverrides'

describe('K4.2 friend action overrides', () => {
  it('marks the seven friend actions ready with independent config schemas', () => {
    applyK42FriendActionOverrides()
    const friendActions = ACTION_REGISTRY.filter((item) => item.category === 'friends')
    expect(friendActions).toHaveLength(7)
    expect(friendActions.every((item) => item.runtimeStatus === 'ready')).toBe(true)
    expect(friendActions.every((item) => item.configSchema.fields.length > 0)).toBe(true)
  })

  it('validates action-specific ranges and required sources', () => {
    expect(getK42ValidationErrors('poke_friend', { pokeMin: 10, pokeMax: 5, itemDelayMinSeconds: 0, itemDelayMaxSeconds: 0 })).toContain('Chọc bạn bè: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
    expect(getK42ValidationErrors('unfriend', { uids: '', unfriendMin: 1, unfriendMax: 2, itemDelayMinSeconds: 0, itemDelayMaxSeconds: 0 })).toContain('Danh sách UID: không được để trống.')
    expect(getK42ValidationErrors('friend_from_engagement', { sourceTargets: '', requestMin: 1, requestMax: 2, itemDelayMinSeconds: 0, itemDelayMaxSeconds: 0 })).toContain('Danh sách nguồn: không được để trống.')
  })
})
