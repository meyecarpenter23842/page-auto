import type Database from 'better-sqlite3'
import {
  IMAGE_MODES,
  MISSING_IMAGE_POLICIES,
  type ImageMode,
  type MissingImagePolicy,
  type PageTabImageConfig
} from '../../shared/pageTabs'
import type { RunSnapshotPost } from '../../shared/runs'

export interface CanonicalPostDraft {
  name: string
  variants: readonly string[]
  image: PageTabImageConfig
}

export interface CanonicalPostRecord {
  id: number
  name: string
  variants: string[]
  image: PageTabImageConfig
  createdAt: number
  updatedAt: number
}

export interface PostBindingOverrides {
  name: string | null
  variants: string[] | null
  imageFolderPath: string | null
  imageMode: ImageMode | null
  imagesPerPost: number | null
  missingPolicy: MissingImagePolicy | null
}

export interface PostBindingOverridePatch {
  name?: string | null
  variants?: readonly string[] | null
  imageFolderPath?: string | null
  imageMode?: ImageMode | null
  imagesPerPost?: number | null
  missingPolicy?: MissingImagePolicy | null
}

export interface ResolvedPostBinding {
  bindingId: number
  postId: number
  enabled: boolean
  sortOrder: number
  name: string
  variants: string[]
  image: PageTabImageConfig
  overrides: PostBindingOverrides
}

interface CanonicalPostRow {
  id: number
  name: string
  variantsJson: string
  imageFolderPath: string
  imageMode: string
  imagesPerPost: number
  missingPolicy: string
  createdAt: number
  updatedAt: number
}

interface BindingRow {
  bindingId: number
  postId: number
  enabled: number
  sortOrder: number
  nameOverride: string | null
  variantsOverrideJson: string | null
  imageFolderPathOverride: string | null
  imageModeOverride: string | null
  imagesPerPostOverride: number | null
  missingPolicyOverride: string | null
  baseName: string
  baseVariantsJson: string
  baseImageFolderPath: string
  baseImageMode: string
  baseImagesPerPost: number
  baseMissingPolicy: string
}

interface BindingStorageConfig {
  table: 'page_tab_post_bindings' | 'scenario_action_post_bindings'
  contextColumn: 'page_tab_id' | 'scenario_action_id'
  contextTable: 'page_tabs' | 'scenario_actions'
  contextLabel: string
}

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} không hợp lệ.`)
  return value
}

function normalizeVariants(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean)
}

function normalizeName(value: string, label = 'Tên bài viết'): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} không được để trống.`)
  if (normalized.length > 160) throw new Error(`${label} tối đa 160 ký tự.`)
  return normalized
}

function normalizeImage(image: PageTabImageConfig): PageTabImageConfig {
  if (!IMAGE_MODES.includes(image.mode)) throw new Error('Chế độ ảnh của bài viết không hợp lệ.')
  if (!MISSING_IMAGE_POLICIES.includes(image.missingPolicy)) throw new Error('Policy thiếu ảnh không hợp lệ.')
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

function normalizeDraft(input: CanonicalPostDraft): CanonicalPostDraft {
  const name = normalizeName(input.name)
  const variants = normalizeVariants(input.variants)
  const image = normalizeImage(input.image)
  if (!variants.length && !image.folderPath) {
    throw new Error(`“${name}” cần có nội dung hoặc folder ảnh.`)
  }
  return { name, variants, image }
}

function parseVariants(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function validImageMode(value: unknown, fallback: ImageMode): ImageMode {
  const normalized = String(value ?? '')
  return IMAGE_MODES.includes(normalized as ImageMode) ? normalized as ImageMode : fallback
}

function validMissingPolicy(value: unknown, fallback: MissingImagePolicy): MissingImagePolicy {
  const normalized = String(value ?? '')
  return MISSING_IMAGE_POLICIES.includes(normalized as MissingImagePolicy)
    ? normalized as MissingImagePolicy
    : fallback
}

function postFromRow(row: CanonicalPostRow): CanonicalPostRecord {
  return {
    id: Number(row.id),
    name: String(row.name),
    variants: parseVariants(row.variantsJson),
    image: {
      folderPath: String(row.imageFolderPath ?? ''),
      mode: validImageMode(row.imageMode, 'random'),
      imagesPerPost: Math.max(1, Number(row.imagesPerPost) || 1),
      missingPolicy: validMissingPolicy(row.missingPolicy, 'text_only')
    },
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt)
  }
}

const canonicalColumns = `
  id, name, variants_json AS variantsJson,
  image_folder_path AS imageFolderPath, image_mode AS imageMode,
  images_per_post AS imagesPerPost, missing_policy AS missingPolicy,
  created_at AS createdAt, updated_at AS updatedAt
`

export class CanonicalPostRepository {
  constructor(private readonly client: Database.Database) {}

  list(): CanonicalPostRecord[] {
    const rows = this.client.prepare(`
      SELECT ${canonicalColumns}
      FROM posts
      ORDER BY updated_at DESC, id DESC
    `).all() as CanonicalPostRow[]
    return rows.map(postFromRow)
  }

  get(id: number): CanonicalPostRecord | null {
    positiveId(id, 'Post ID')
    const row = this.client.prepare(`
      SELECT ${canonicalColumns}
      FROM posts
      WHERE id = ?
    `).get(id) as CanonicalPostRow | undefined
    return row ? postFromRow(row) : null
  }

  create(input: CanonicalPostDraft, now = Date.now()): CanonicalPostRecord {
    const post = normalizeDraft(input)
    const result = this.client.prepare(`
      INSERT INTO posts (
        name, variants_json, image_folder_path, image_mode,
        images_per_post, missing_policy, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      post.name,
      JSON.stringify(post.variants),
      post.image.folderPath,
      post.image.mode,
      post.image.imagesPerPost,
      post.image.missingPolicy,
      now,
      now
    )
    return this.require(Number(result.lastInsertRowid))
  }

  update(id: number, input: CanonicalPostDraft, now = Date.now()): CanonicalPostRecord {
    const postId = positiveId(id, 'Post ID')
    this.require(postId)
    const post = normalizeDraft(input)
    this.client.prepare(`
      UPDATE posts
      SET
        name = ?, variants_json = ?, image_folder_path = ?, image_mode = ?,
        images_per_post = ?, missing_policy = ?, updated_at = ?
      WHERE id = ?
    `).run(
      post.name,
      JSON.stringify(post.variants),
      post.image.folderPath,
      post.image.mode,
      post.image.imagesPerPost,
      post.image.missingPolicy,
      now,
      postId
    )
    return this.require(postId)
  }

  delete(id: number): boolean {
    const postId = positiveId(id, 'Post ID')
    if (!this.get(postId)) return false

    const usages = this.client.prepare(`
      SELECT
        (SELECT COUNT(*) FROM post_collection_bindings WHERE post_id = ?) +
        (SELECT COUNT(*) FROM page_tab_post_bindings WHERE post_id = ?) +
        (SELECT COUNT(*) FROM scenario_action_post_bindings WHERE post_id = ?) AS count
    `).get(postId, postId, postId) as { count: number }

    if (Number(usages.count) > 0) {
      throw new Error(`Bài viết #${postId} đang được sử dụng; hãy bỏ liên kết trước khi xóa vĩnh viễn.`)
    }
    return this.client.prepare('DELETE FROM posts WHERE id = ?').run(postId).changes === 1
  }

  require(id: number): CanonicalPostRecord {
    const post = this.get(id)
    if (!post) throw new Error(`Không tìm thấy bài viết #${id}.`)
    return post
  }
}

class ContextPostBindingRepository {
  private readonly canonical: CanonicalPostRepository

  constructor(
    private readonly client: Database.Database,
    private readonly storage: BindingStorageConfig
  ) {
    this.canonical = new CanonicalPostRepository(client)
  }

  list(contextId: number): ResolvedPostBinding[] {
    const id = this.requireContext(contextId)
    const { table, contextColumn } = this.storage
    const rows = this.client.prepare(`
      SELECT
        b.id AS bindingId,
        b.post_id AS postId,
        b.enabled,
        b.sort_order AS sortOrder,
        b.name_override AS nameOverride,
        b.variants_override_json AS variantsOverrideJson,
        b.image_folder_path_override AS imageFolderPathOverride,
        b.image_mode_override AS imageModeOverride,
        b.images_per_post_override AS imagesPerPostOverride,
        b.missing_policy_override AS missingPolicyOverride,
        p.name AS baseName,
        p.variants_json AS baseVariantsJson,
        p.image_folder_path AS baseImageFolderPath,
        p.image_mode AS baseImageMode,
        p.images_per_post AS baseImagesPerPost,
        p.missing_policy AS baseMissingPolicy
      FROM ${table} b
      JOIN posts p ON p.id = b.post_id
      WHERE b.${contextColumn} = ?
      ORDER BY b.sort_order, b.id
    `).all(id) as BindingRow[]
    return rows.map((row) => this.resolve(row))
  }

  createAndBind(contextId: number, input: CanonicalPostDraft, now = Date.now()): ResolvedPostBinding {
    const id = this.requireContext(contextId)
    const transaction = this.client.transaction(() => {
      const post = this.canonical.create(input, now)
      this.insertBinding(id, post.id, now)
      return post.id
    })
    const postId = transaction()
    return this.requireBinding(id, postId)
  }

  bindExisting(contextId: number, postId: number, now = Date.now()): ResolvedPostBinding {
    const id = this.requireContext(contextId)
    const canonicalId = positiveId(postId, 'Post ID')
    this.canonical.require(canonicalId)
    this.insertBinding(id, canonicalId, now)
    return this.requireBinding(id, canonicalId)
  }

  unlink(contextId: number, postId: number, now = Date.now()): boolean {
    const id = this.requireContext(contextId)
    const canonicalId = positiveId(postId, 'Post ID')
    const { table, contextColumn } = this.storage
    const transaction = this.client.transaction(() => {
      const result = this.client.prepare(`
        DELETE FROM ${table}
        WHERE ${contextColumn} = ? AND post_id = ?
      `).run(id, canonicalId)
      if (result.changes > 0) this.compactOrder(id, now)
      return result.changes > 0
    })
    return transaction()
  }

  setEnabled(contextId: number, postId: number, enabled: boolean, now = Date.now()): ResolvedPostBinding {
    const current = this.requireBinding(contextId, postId)
    const { table } = this.storage
    this.client.prepare(`
      UPDATE ${table}
      SET enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(enabled ? 1 : 0, now, current.bindingId)
    return this.requireBinding(contextId, postId)
  }

  updateOverrides(
    contextId: number,
    postId: number,
    patch: PostBindingOverridePatch,
    now = Date.now()
  ): ResolvedPostBinding {
    const current = this.requireBinding(contextId, postId)
    const overrides = this.normalizeOverridePatch(current.overrides, patch)
    const { table } = this.storage
    this.client.prepare(`
      UPDATE ${table}
      SET
        name_override = ?,
        variants_override_json = ?,
        image_folder_path_override = ?,
        image_mode_override = ?,
        images_per_post_override = ?,
        missing_policy_override = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      overrides.name,
      overrides.variants === null ? null : JSON.stringify(overrides.variants),
      overrides.imageFolderPath,
      overrides.imageMode,
      overrides.imagesPerPost,
      overrides.missingPolicy,
      now,
      current.bindingId
    )
    return this.requireBinding(contextId, postId)
  }

  move(contextId: number, postId: number, direction: 'up' | 'down', now = Date.now()): ResolvedPostBinding[] {
    const id = this.requireContext(contextId)
    const canonicalId = positiveId(postId, 'Post ID')
    const current = this.list(id)
    const index = current.findIndex((item) => item.postId === canonicalId)
    if (index < 0) throw new Error(`Bài viết #${canonicalId} chưa được gắn vào ${this.storage.contextLabel}.`)
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= current.length) return current

    const reordered = [...current]
    const [moved] = reordered.splice(index, 1)
    if (!moved) return current
    reordered.splice(target, 0, moved)
    const { table } = this.storage
    const transaction = this.client.transaction(() => {
      const update = this.client.prepare(`UPDATE ${table} SET sort_order = ?, updated_at = ? WHERE id = ?`)
      reordered.forEach((item, sortOrder) => update.run(sortOrder, now, item.bindingId))
    })
    transaction()
    return this.list(id)
  }

  resolveSnapshotPosts(contextId: number): RunSnapshotPost[] {
    return this.list(contextId)
      .filter((binding) => binding.enabled)
      .map((binding, index) => ({
        name: binding.name,
        enabled: true,
        sortOrder: index,
        variants: [...binding.variants],
        image: { ...binding.image }
      }))
      .filter((post) => post.variants.length > 0 || post.image.folderPath.length > 0)
  }

  private requireContext(value: number): number {
    const id = positiveId(value, `${this.storage.contextLabel} ID`)
    const row = this.client.prepare(`
      SELECT 1 AS found
      FROM ${this.storage.contextTable}
      WHERE id = ?
    `).get(id) as { found: number } | undefined
    if (!row) throw new Error(`Không tìm thấy ${this.storage.contextLabel} #${id}.`)
    return id
  }

  private insertBinding(contextId: number, postId: number, now: number): void {
    const { table, contextColumn } = this.storage
    const existing = this.client.prepare(`
      SELECT id FROM ${table}
      WHERE ${contextColumn} = ? AND post_id = ?
    `).get(contextId, postId) as { id: number } | undefined
    if (existing) throw new Error(`Bài viết #${postId} đã được gắn vào ${this.storage.contextLabel}.`)

    const next = this.client.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
      FROM ${table}
      WHERE ${contextColumn} = ?
    `).get(contextId) as { next: number }

    this.client.prepare(`
      INSERT INTO ${table} (
        ${contextColumn}, post_id, enabled, sort_order,
        name_override, variants_override_json, image_folder_path_override,
        image_mode_override, images_per_post_override, missing_policy_override,
        created_at, updated_at
      ) VALUES (?, ?, 1, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
    `).run(contextId, postId, Number(next.next), now, now)
  }

  private requireBinding(contextId: number, postId: number): ResolvedPostBinding {
    const id = this.requireContext(contextId)
    const canonicalId = positiveId(postId, 'Post ID')
    const binding = this.list(id).find((item) => item.postId === canonicalId)
    if (!binding) throw new Error(`Bài viết #${canonicalId} chưa được gắn vào ${this.storage.contextLabel}.`)
    return binding
  }

  private compactOrder(contextId: number, now: number): void {
    const { table, contextColumn } = this.storage
    const rows = this.client.prepare(`
      SELECT id FROM ${table}
      WHERE ${contextColumn} = ?
      ORDER BY sort_order, id
    `).all(contextId) as Array<{ id: number }>
    const update = this.client.prepare(`UPDATE ${table} SET sort_order = ?, updated_at = ? WHERE id = ?`)
    rows.forEach((row, index) => update.run(index, now, row.id))
  }

  private resolve(row: BindingRow): ResolvedPostBinding {
    const baseImageMode = validImageMode(row.baseImageMode, 'random')
    const baseMissingPolicy = validMissingPolicy(row.baseMissingPolicy, 'text_only')
    const overrideImageMode = row.imageModeOverride === null
      ? null
      : validImageMode(row.imageModeOverride, baseImageMode)
    const overrideMissingPolicy = row.missingPolicyOverride === null
      ? null
      : validMissingPolicy(row.missingPolicyOverride, baseMissingPolicy)
    const overrides: PostBindingOverrides = {
      name: row.nameOverride,
      variants: row.variantsOverrideJson === null ? null : parseVariants(row.variantsOverrideJson),
      imageFolderPath: row.imageFolderPathOverride,
      imageMode: overrideImageMode,
      imagesPerPost: row.imagesPerPostOverride === null ? null : Math.max(1, Number(row.imagesPerPostOverride) || 1),
      missingPolicy: overrideMissingPolicy
    }
    return {
      bindingId: Number(row.bindingId),
      postId: Number(row.postId),
      enabled: Number(row.enabled) === 1,
      sortOrder: Number(row.sortOrder),
      name: overrides.name ?? String(row.baseName),
      variants: overrides.variants === null ? parseVariants(row.baseVariantsJson) : [...overrides.variants],
      image: {
        folderPath: overrides.imageFolderPath ?? String(row.baseImageFolderPath ?? ''),
        mode: overrides.imageMode ?? baseImageMode,
        imagesPerPost: overrides.imagesPerPost ?? Math.max(1, Number(row.baseImagesPerPost) || 1),
        missingPolicy: overrides.missingPolicy ?? baseMissingPolicy
      },
      overrides
    }
  }

  private normalizeOverridePatch(
    current: PostBindingOverrides,
    patch: PostBindingOverridePatch
  ): PostBindingOverrides {
    const name = patch.name === undefined
      ? current.name
      : patch.name === null
        ? null
        : normalizeName(patch.name, 'Tên override')

    const variants = patch.variants === undefined
      ? current.variants
      : patch.variants === null
        ? null
        : normalizeVariants(patch.variants)

    const imageFolderPath = patch.imageFolderPath === undefined
      ? current.imageFolderPath
      : patch.imageFolderPath === null
        ? null
        : patch.imageFolderPath.trim()

    let imageMode = current.imageMode
    if (patch.imageMode !== undefined) {
      if (patch.imageMode !== null && !IMAGE_MODES.includes(patch.imageMode)) {
        throw new Error('Chế độ ảnh override không hợp lệ.')
      }
      imageMode = patch.imageMode
    }

    let imagesPerPost = current.imagesPerPost
    if (patch.imagesPerPost !== undefined) {
      if (patch.imagesPerPost !== null && (
        !Number.isSafeInteger(patch.imagesPerPost) ||
        patch.imagesPerPost < 1 ||
        patch.imagesPerPost > 50
      )) {
        throw new Error('Số ảnh override mỗi bài phải từ 1 đến 50.')
      }
      imagesPerPost = patch.imagesPerPost
    }

    let missingPolicy = current.missingPolicy
    if (patch.missingPolicy !== undefined) {
      if (patch.missingPolicy !== null && !MISSING_IMAGE_POLICIES.includes(patch.missingPolicy)) {
        throw new Error('Policy thiếu ảnh override không hợp lệ.')
      }
      missingPolicy = patch.missingPolicy
    }

    return { name, variants, imageFolderPath, imageMode, imagesPerPost, missingPolicy }
  }
}

export class PageTabPostBindingRepository extends ContextPostBindingRepository {
  constructor(client: Database.Database) {
    super(client, {
      table: 'page_tab_post_bindings',
      contextColumn: 'page_tab_id',
      contextTable: 'page_tabs',
      contextLabel: 'Page Tab'
    })
  }
}

export class ScenarioActionPostBindingRepository extends ContextPostBindingRepository {
  constructor(client: Database.Database) {
    super(client, {
      table: 'scenario_action_post_bindings',
      contextColumn: 'scenario_action_id',
      contextTable: 'scenario_actions',
      contextLabel: 'Scenario Action'
    })
  }
}
