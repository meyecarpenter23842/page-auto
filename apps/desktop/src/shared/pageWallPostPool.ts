import type { PageWallPlanCanonicalPostSource } from './pageWallPlans'

export const PAGE_WALL_POST_SELECTION_MODES = ['sequential', 'random'] as const
export type PageWallPostSelectionMode = (typeof PAGE_WALL_POST_SELECTION_MODES)[number]

export interface PageWallSchedulePostPoolInput {
  mode: PageWallPostSelectionMode
  posts: PageWallPlanCanonicalPostSource[]
}

export interface PageWallSchedulePostPoolRecord extends PageWallSchedulePostPoolInput {
  groupKey: string
  slotOrder: number
}

export function normalizePageWallSchedulePostPool(
  input: PageWallSchedulePostPoolInput
): PageWallSchedulePostPoolInput {
  if (!PAGE_WALL_POST_SELECTION_MODES.includes(input.mode)) {
    throw new Error('Cách lấy bài của lịch Đăng Tường không hợp lệ.')
  }

  const posts: PageWallPlanCanonicalPostSource[] = []
  const seen = new Set<number>()
  for (const source of Array.isArray(input.posts) ? input.posts : []) {
    if (source?.kind !== 'canonical') continue
    if (!Number.isSafeInteger(source.postId) || source.postId <= 0 || seen.has(source.postId)) continue
    if (!Number.isSafeInteger(source.variantIndex) || source.variantIndex < 0) {
      throw new Error(`Biến thể của bài #${source.postId} không hợp lệ.`)
    }
    seen.add(source.postId)
    posts.push({ kind: 'canonical', postId: source.postId, variantIndex: source.variantIndex })
  }

  if (posts.length === 0) throw new Error('Lịch Đăng Tường cần ít nhất một bài viết.')
  if (posts.length > 200) throw new Error('Một lịch Đăng Tường hỗ trợ tối đa 200 bài viết.')

  return { mode: input.mode, posts }
}

function seedFrom(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0 || 0x9e3779b9
}

function nextRandom(state: { value: number }): number {
  let value = state.value >>> 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  state.value = value >>> 0
  return state.value / 0x1_0000_0000
}

function shuffledIndexes(length: number, seed: string): number[] {
  const values = Array.from({ length }, (_unused, index) => index)
  const state = { value: seedFrom(seed) }
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(nextRandom(state) * (index + 1))
    ;[values[index], values[target]] = [values[target]!, values[index]!]
  }
  return values
}

export function selectPageWallSchedulePost(
  pool: PageWallSchedulePostPoolRecord,
  occurrenceOrdinal: number
): PageWallPlanCanonicalPostSource {
  const normalized = normalizePageWallSchedulePostPool(pool)
  const ordinal = Number.isSafeInteger(occurrenceOrdinal) && occurrenceOrdinal >= 0 ? occurrenceOrdinal : 0
  if (normalized.mode === 'sequential') {
    return { ...normalized.posts[ordinal % normalized.posts.length]! }
  }

  const cycle = Math.floor(ordinal / normalized.posts.length)
  const offset = ordinal % normalized.posts.length
  const order = shuffledIndexes(normalized.posts.length, `${pool.groupKey}:${cycle}`)
  return { ...normalized.posts[order[offset]!]! }
}
