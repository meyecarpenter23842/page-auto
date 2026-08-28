import type { ActionConfigFieldDefinition } from '../../../shared/actionRegistry'

export const REACTION_OPTIONS = [
  { key: 'reactionLike', icon: '👍', label: 'Like' },
  { key: 'reactionLove', icon: '❤️', label: 'Love' },
  { key: 'reactionCare', icon: '🤗', label: 'Care' },
  { key: 'reactionHaha', icon: '😂', label: 'Haha' },
  { key: 'reactionWow', icon: '😮', label: 'Wow' },
  { key: 'reactionSad', icon: '😢', label: 'Sad' },
  { key: 'reactionAngry', icon: '😡', label: 'Angry' }
] as const

const REACTION_KEYS = new Set<string>(REACTION_OPTIONS.map((item) => item.key))

function getRangeRole(key: string): 'min' | 'max' | null {
  if (/Min(?=[A-Z]|$)/.test(key)) return 'min'
  if (/Max(?=[A-Z]|$)/.test(key)) return 'max'
  return null
}

function getRangeFamily(key: string): string {
  return key.replace(/Min(?=[A-Z]|$)/, '').replace(/Max(?=[A-Z]|$)/, '')
}

export function getRangeLabel(minLabel: string, maxLabel: string): string {
  const strip = (label: string) => label.replace(/\s+(từ|đến)$/iu, '').trim()
  const left = strip(minLabel)
  const right = strip(maxLabel)
  return left === right ? left : `${left} / ${right}`
}

export type ActionConfigLayoutUnit =
  | { kind: 'field'; field: ActionConfigFieldDefinition }
  | { kind: 'range'; min: ActionConfigFieldDefinition; max: ActionConfigFieldDefinition }
  | { kind: 'reactions'; fields: ActionConfigFieldDefinition[] }

export function buildActionConfigLayout(fields: ActionConfigFieldDefinition[]): ActionConfigLayoutUnit[] {
  const emitted = new Set<string>()
  const units: ActionConfigLayoutUnit[] = []
  const reactionFields = fields.filter((field) => REACTION_KEYS.has(field.key))

  for (const field of fields) {
    if (emitted.has(field.key)) continue

    if (REACTION_KEYS.has(field.key)) {
      for (const reaction of reactionFields) emitted.add(reaction.key)
      units.push({ kind: 'reactions', fields: reactionFields })
      continue
    }

    const role = field.kind === 'number' ? getRangeRole(field.key) : null
    if (role) {
      const family = getRangeFamily(field.key)
      const partner = fields.find((candidate) =>
        candidate.kind === 'number'
        && !emitted.has(candidate.key)
        && getRangeFamily(candidate.key) === family
        && getRangeRole(candidate.key) !== role
      )
      if (partner) {
        const min = role === 'min' ? field : partner
        const max = role === 'max' ? field : partner
        emitted.add(min.key)
        emitted.add(max.key)
        units.push({ kind: 'range', min, max })
        continue
      }
    }

    emitted.add(field.key)
    units.push({ kind: 'field', field })
  }

  return units
}
