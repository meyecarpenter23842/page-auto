export const CONTENT_SPIN_ICON_OPTIONS = [
  { token: '[r]', label: '[r] · ✨ 🔥', samples: ['✨', '🔥'], pool: ['✨', '🔥', '⭐', '💥', '📌', '🎯', '💎', '🚀', '✅', '❤️'] },
  { token: '[r0]', label: '[r0] · ★ ✿', samples: ['★', '✿'], pool: ['✲', '⋆', '❅', '❈', '❖', '✫', '✪', '✩', '✬', '✮', '✭', '✯', '✰', '✹', '✸', '✷', '✶', '✵', '✱', '❊', '❉', '✾', '✽', '✼', '✠', '☆', '★', '✺', '☼', '❋', '✻', '❆', '❃', '❂', '✿', '❀', '❁'] },
  { token: '[r1]', label: '[r1] · ➤ ➜', samples: ['➤', '➜'], pool: ['➤', '➜', '➔', '➣', '➥', '➡', '➠', '➳'] },
  { token: '[r2]', label: '[r2] · ✅ ✔', samples: ['✅', '✔'], pool: ['✅', '✔', '✓', '☑', '❎', '🔹', '🔸'] },
  { token: '[r3]', label: '[r3] · 👉 👇', samples: ['👉', '👇'], pool: ['👉', '👇', '☝', '👈', '🤝', '🙌', '👏'] },
  { token: '[r4]', label: '[r4] · ❤️ 💛', samples: ['❤️', '💛'], pool: ['❤️', '💛', '💚', '💙', '💜', '💖', '💗', '💝'] },
  { token: '[r5]', label: '[r5] · 🔴 🟢', samples: ['🔴', '🟢'], pool: ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚪', '🟤'] },
  { token: '[r6]', label: '[r6] · 🌸 ✨', samples: ['🌸', '✨'], pool: ['🌸', '🌼', '🌺', '🌻', '🌷', '✨', '💫', '🌟'] },
  { token: '[r7]', label: '[r7] · 📌 📣', samples: ['📌', '📣'], pool: ['📌', '📍', '📣', '🔔', '💡', '🎯', '📝', '📢'] },
  { token: '[r8]', label: '[r8] · 🛒 📦', samples: ['🛒', '📦'], pool: ['🛒', '📦', '🏷', '🎁', '💰', '💎', '🧾', '🚚'] }
] as const

export type ContentSpinIconToken = (typeof CONTENT_SPIN_ICON_OPTIONS)[number]['token']

export interface ContentSpinContext {
  targetName?: string | null
  recipientName?: string | null
  now?: Date
  random?: () => number
}

const TOKEN_PATTERN = /\[(r[0-8]?|u|g|f|n|d|t|w)\]/g
const ICON_POOL = new Map<string, readonly string[]>(
  CONTENT_SPIN_ICON_OPTIONS.map((option) => [option.token.slice(1, -1), option.pool])
)

function randomIndex(length: number, random: () => number): number {
  if (length <= 1) return 0
  const value = random()
  const normalized = Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0
  return Math.floor(normalized * length)
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function dateText(now: Date): string {
  return `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}`
}

function timeText(now: Date): string {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`
}

function nameWithoutSurname(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? ''
  if (!normalized) return null
  const parts = normalized.split(' ')
  return parts.length > 1 ? parts.slice(1).join(' ') : normalized
}

function randomDigits(random: () => number, length = 6): string {
  let result = ''
  for (let index = 0; index < length; index += 1) {
    result += String(randomIndex(10, random))
  }
  return result
}

function hasBalancedSpinBraces(source: string): boolean {
  let depth = 0
  for (const character of source) {
    if (character === '{') depth += 1
    else if (character === '}') {
      if (depth === 0) return false
      depth -= 1
    }
  }
  return depth === 0
}

function splitAtCurrentDepth(source: string): string[] {
  const branches: string[] = []
  let depth = 0
  let start = 0

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '{') depth += 1
    else if (character === '}') depth -= 1
    else if (character === '|' && depth === 0) {
      branches.push(source.slice(start, index))
      start = index + 1
    }
  }

  branches.push(source.slice(start))
  return branches
}

function matchingBraceIndex(source: string, openIndex: number): number {
  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index]
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function spinBraceGroups(source: string, random: () => number): string {
  let result = ''
  let index = 0

  while (index < source.length) {
    if (source[index] !== '{') {
      result += source[index] ?? ''
      index += 1
      continue
    }

    const closeIndex = matchingBraceIndex(source, index)
    if (closeIndex < 0) return source

    const rawGroup = source.slice(index + 1, closeIndex)
    const options = splitAtCurrentDepth(rawGroup)
    const selected = options[randomIndex(options.length, random)] ?? ''
    result += spinBraceGroups(selected.trim(), random)
    index = closeIndex + 1
  }

  return result
}

function spinStructuredContent(source: string, random: () => number): string {
  if (!hasBalancedSpinBraces(source)) return source

  const branches = splitAtCurrentDepth(source)
  const chosenBranch = branches.length > 1
    ? branches[randomIndex(branches.length, random)] ?? ''
    : branches[0] ?? ''

  return spinBraceGroups(chosenBranch.trim(), random)
}

export function spinContent(source: string, context: ContentSpinContext = {}): string {
  const random = context.random ?? Math.random
  const now = context.now ?? new Date()
  const targetName = context.targetName?.trim() || null
  const shortRecipientName = nameWithoutSurname(context.recipientName)
  const structured = spinStructuredContent(source, random)

  return structured.replace(TOKEN_PATTERN, (original, rawToken: string) => {
    if (rawToken === 'u') return targetName ?? original
    if (rawToken === 'f') return shortRecipientName ?? original
    if (rawToken === 'g') return random() < 0.5 ? 'anh' : 'chị'
    if (rawToken === 'n') return randomDigits(random)
    if (rawToken === 'd') return dateText(now)
    if (rawToken === 't') return timeText(now)
    if (rawToken === 'w') return String.fromCharCode(97 + randomIndex(26, random))

    const pool = ICON_POOL.get(rawToken)
    if (!pool?.length) return original
    return pool[randomIndex(pool.length, random)] ?? original
  })
}

export function addSpinTokenToAiLines(output: string, token: ContentSpinIconToken | ''): string {
  if (!token) return output
  const iconTokenPattern = /^\[r(?:[0-8])?\](?:\s|$)/

  return output
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed === '|' || trimmed.startsWith('#') || iconTokenPattern.test(trimmed)) {
        return line
      }
      const indent = line.match(/^\s*/)?.[0] ?? ''
      return `${indent}${token} ${line.slice(indent.length)}`
    })
    .join('\n')
}
