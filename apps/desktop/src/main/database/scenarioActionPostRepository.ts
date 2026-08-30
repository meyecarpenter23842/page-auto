import type Database from 'better-sqlite3'
import type {
  CanonicalPostSummary,
  PageTabImageConfig,
  PageTabPostBindingOverrides
} from '../../shared/pageTabs'
import type {
  ScenarioActionPostInput,
  ScenarioActionPostItem
} from '../../shared/scenarios'
import {
  CanonicalPostRepository,
  ScenarioActionPostBindingRepository,
  type PostBindingOverrides,
  type ResolvedPostBinding
} from './canonicalPostRepository'

interface NormalizedPostInput extends ScenarioActionPostInput {
  name: string
  variants: string[]
  image: PageTabImageConfig
  sortOrder: number
}

function normalizeVariants(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean)
}

function normalizeImage(image: PageTabImageConfig): PageTabImageConfig {
  if (!Number.isSafeInteger(image.imagesPerPost) || image.imagesPerPost < 1 || image.imagesPerPost > 50) {
    throw new Error('Số ảnh mỗi bài phải từ 1 đến 50.')
  }
  return {
    folderPath: image.folderPath.trim(),
    mode: image.mode,
    imagesPerPost: image.imagesPerPost,
    missingPolicy: image.missingPolicy
  }
}

function normalizePost(input: ScenarioActionPostInput, index: number): NormalizedPostInput {
  const variants = normalizeVariants(input.variants)
  const image = normalizeImage(input.image)
  const name = input.name.trim() || `Bài viết ${index + 1}`
  if (name.length > 160) throw new Error('Tên bài viết tối đa 160 ký tự.')
  if (!variants.length && !image.folderPath) throw new Error(`“${name}” cần có nội dung hoặc folder ảnh.`)
  if (input.postId !== undefined && input.postId !== null && (!Number.isSafeInteger(input.postId) || input.postId <= 0)) {
    throw new Error('Post ID không hợp lệ.')
  }
  return { ...input, name, variants, image, sortOrder: index }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function canonicalSummary(post: ReturnType<CanonicalPostRepository['require']>): CanonicalPostSummary {
  return {
    postId: post.id,
    name: post.name,
    variants: [...post.variants],
    image: { ...post.image },
    createdAt: post.createdAt,
    updatedAt: post.updatedAt
  }
}

function overridePatch(
  input: NormalizedPostInput,
  canonical: ReturnType<CanonicalPostRepository['require']>
): PostBindingOverrides {
  return {
    name: input.name === canonical.name ? null : input.name,
    variants: sameStrings(input.variants, canonical.variants) ? null : [...input.variants],
    imageFolderPath: input.image.folderPath === canonical.image.folderPath ? null : input.image.folderPath,
    imageMode: input.image.mode === canonical.image.mode ? null : input.image.mode,
    imagesPerPost: input.image.imagesPerPost === canonical.image.imagesPerPost ? null : input.image.imagesPerPost,
    missingPolicy: input.image.missingPolicy === canonical.image.missingPolicy ? null : input.image.missingPolicy
  }
}

function toItem(
  binding: ResolvedPostBinding,
  canonical: ReturnType<CanonicalPostRepository['require']>
): ScenarioActionPostItem {
  const overrides: PageTabPostBindingOverrides = {
    name: binding.overrides.name,
    variants: binding.overrides.variants === null ? null : [...binding.overrides.variants],
    imageFolderPath: binding.overrides.imageFolderPath,
    imageMode: binding.overrides.imageMode,
    imagesPerPost: binding.overrides.imagesPerPost,
    missingPolicy: binding.overrides.missingPolicy
  }
  return {
    id: binding.bindingId,
    postId: binding.postId,
    name: binding.name,
    enabled: binding.enabled,
    sortOrder: binding.sortOrder,
    variants: [...binding.variants],
    image: { ...binding.image },
    canonical: canonicalSummary(canonical),
    overrides
  }
}

export class ScenarioActionPostRepository {
  private readonly canonical: CanonicalPostRepository
  private readonly bindings: ScenarioActionPostBindingRepository

  constructor(private readonly client: Database.Database) {
    this.canonical = new CanonicalPostRepository(client)
    this.bindings = new ScenarioActionPostBindingRepository(client)
  }

  list(actionId: number): ScenarioActionPostItem[] {
    return this.bindings.list(actionId).map((binding) => toItem(binding, this.canonical.require(binding.postId)))
  }

  save(actionId: number, input: readonly ScenarioActionPostInput[], now = Date.now()): ScenarioActionPostItem[] {
    const normalized = input.map(normalizePost)
    const current = this.bindings.list(actionId)
    const transaction = this.client.transaction(() => {
      const desiredPostIds: number[] = []

      normalized.forEach((post) => {
        const requestedPostId = typeof post.postId === 'number' ? post.postId : null
        let binding: ResolvedPostBinding
        if (requestedPostId === null) {
          binding = this.bindings.createAndBind(actionId, {
            name: post.name,
            variants: post.variants,
            image: post.image
          }, now)
        } else {
          const alreadyBound = current.find((item) => item.postId === requestedPostId)
            ?? this.bindings.list(actionId).find((item) => item.postId === requestedPostId)
          binding = alreadyBound ?? this.bindings.bindExisting(actionId, requestedPostId, now)
          const canonical = this.canonical.require(requestedPostId)
          binding = this.bindings.updateOverrides(actionId, requestedPostId, overridePatch(post, canonical), now)
        }
        if (binding.enabled !== post.enabled) {
          binding = this.bindings.setEnabled(actionId, binding.postId, post.enabled, now)
        }
        desiredPostIds.push(binding.postId)
      })

      const desired = new Set(desiredPostIds)
      this.bindings.list(actionId)
        .filter((binding) => !desired.has(binding.postId))
        .forEach((binding) => this.bindings.unlink(actionId, binding.postId, now))

      const updateOrder = this.client.prepare(`
        UPDATE scenario_action_post_bindings
        SET sort_order = ?, updated_at = ?
        WHERE scenario_action_id = ? AND post_id = ?
      `)
      desiredPostIds.forEach((postId, index) => updateOrder.run(index, now, actionId, postId))
    })
    transaction()
    return this.list(actionId)
  }
}
