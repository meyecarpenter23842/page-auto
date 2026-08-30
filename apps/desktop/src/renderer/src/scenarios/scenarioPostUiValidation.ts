import type { ScenarioActionPostInput } from '../../../shared/scenarios'

export function clampScenarioImagesPerPost(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(50, Math.max(1, Math.trunc(value)))
}

export function canDisableScenarioPost(posts: readonly ScenarioActionPostInput[], index: number): boolean {
  const current = posts[index]
  if (!current?.enabled) return true
  return posts.filter((post) => post.enabled).length > 1
}

export function ensureScenarioHasEnabledPost(posts: readonly ScenarioActionPostInput[]): ScenarioActionPostInput[] {
  if (!posts.length || posts.some((post) => post.enabled)) return posts.map((post) => ({ ...post }))
  return posts.map((post, index) => index === 0 ? { ...post, enabled: true } : { ...post })
}
