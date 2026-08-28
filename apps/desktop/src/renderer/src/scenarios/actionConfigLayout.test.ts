import { describe, expect, it } from 'vitest'
import type { ActionConfigFieldDefinition } from '../../../shared/actionRegistry'
import { buildActionConfigLayout, getRangeLabel } from './actionConfigLayout'

const fields: ActionConfigFieldDefinition[] = [
  { key: 'durationMinMinutes', label: 'Xem từ', kind: 'number', defaultValue: 5 },
  { key: 'durationMaxMinutes', label: 'Xem đến', kind: 'number', defaultValue: 10 },
  { key: 'reactionLike', label: 'Like', kind: 'boolean', defaultValue: true },
  { key: 'reactionLove', label: 'Love', kind: 'boolean', defaultValue: false },
  { key: 'commentMin', label: 'Comment từ', kind: 'number', defaultValue: 1 },
  { key: 'commentMax', label: 'Comment đến', kind: 'number', defaultValue: 3 },
  { key: 'randomFriends', label: 'Random bạn bè', kind: 'boolean', defaultValue: false }
]

describe('action config compact layout', () => {
  it('keeps min/max ranges on one unit and reactions in one compact row', () => {
    const units = buildActionConfigLayout(fields)
    expect(units.map((unit) => unit.kind)).toEqual(['range', 'reactions', 'range', 'field'])
    expect(units[0]).toMatchObject({ kind: 'range', min: { key: 'durationMinMinutes' }, max: { key: 'durationMaxMinutes' } })
    expect(units[1]).toMatchObject({ kind: 'reactions' })
    if (units[1]?.kind === 'reactions') expect(units[1].fields.map((field) => field.key)).toEqual(['reactionLike', 'reactionLove'])
  })

  it('uses one short label for a from/to pair', () => {
    expect(getRangeLabel('Số yêu cầu từ', 'Số yêu cầu đến')).toBe('Số yêu cầu')
  })
})
