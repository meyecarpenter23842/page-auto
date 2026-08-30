import type Database from 'better-sqlite3'
import {
  DEFAULT_PAGE_TAB_IMAGE,
  IMAGE_MODES,
  MISSING_IMAGE_POLICIES,
  POST_SELECTION_MODES,
  type CanonicalPostSummary,
  type PageTabImageConfig,
  type PageTabPostItem,
  type PageTabPostLibrary,
  type PostSelectionMode,
  type SavePageTabPostItemInput,
  type SavePageTabPostLibraryInput
} from '../../shared/pageTabs'
import {
  CanonicalPostRepository,
  PageTabPostBindingRepository,
  type PostBindingOverrides,
  type ResolvedPostBinding
} from './canonicalPostRepository'
import { LegacyCanonicalPostBridge } from './legacyCanonicalPostBridge'

interface NormalizedPostInput extends SavePageTabPostItemInput {
  name: string
  variants: string[]
  image: PageTabImageConfig
  sortOrder: number
}

function normalizeVariants(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean)
}

function normalizeImage(image: PageTabImageConfig): PageTabImageConfig {
  if (!IMAGE_MODES.includes(image.mode)) throw new Error('Chế độ ảnh không hợp lệ.')
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

function postErrorMessage(name: string, enabled: boolean): string {
  return enabled
    ? `“${name}” đang bật nhưng chưa có nội dung hoặc folder ảnh.`
    : `“${name}” cần có nội dung hoặc folder ảnh.`
}

function normalizePost(input: SavePageTabPostItemInput, index: number): NormalizedPostInput {
  const variants = normalizeVariants(input.variants)
  const image = normalizeImage(input.image)
  const name = input.name.trim() || `Bài viết ${index + 1}`
  if (name.length > 160) throw new Error('Tên bài viết tối đa 160 ký tự.')
  if (!variants.length && !image.folderPath) {
    throw new Error(postErrorMessage(name, input.enabled))
  }
  if (input.postId !== undefined && input.postId !== null && (!Number.isSafeInteger(input.postId) || input.postId <= 0)) {
    throw new Error('Post ID không hợp lệ.')
  }
  return { ...input, name, variants, image, sortOrder: index }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameImage(left: PageTabImageConfig, right: PageTabImageConfig): boolean {
  return left.folderPath === right.folderPath
    && left.mode === right.mode
    && left.imagesPerPost === right.imagesPerPost
    && left.missingPolicy === right.missingPolicy
}

function matchesResolved(input: NormalizedPostInput, binding: ResolvedPostBinding): boolean {
  return input.name === binding.name
    && input.enabled === binding.enabled
    && sameStrings(input.variants, binding.variants)
    && sameImage(input.image, binding.image)
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

function overridePatch(input: NormalizedPostInput, canonical: ReturnType<CanonicalPostRepository['require']>): PostBindingOverrides {
  return {
    name: input.name === canonical.name ? null : input.name,
    variants: sameStrings(input.variants, canonical.variants) ? null : [...input.variants],
    imageFolderPath: input.image.folderPath === canonical.image.folderPath ? null : input.image.folderPath,
    imageMode: input.image.mode === canonical.image.mode ? null : input.image.mode,
    imagesPerPost: input.image.imagesPerPost === canonical.image.imagesPerPost ? null : input.image.imagesPerPost,
    missingPolicy: input.image.missingPolicy === canonical.image.missingPolicy ? null : input.image.missingPolicy
  }
}

export class PageTabPostRepository {
  private readonly canonical: CanonicalPostRepository
  private readonly bindings: PageTabPostBindingRepository
  private readonly bridge: LegacyCanonicalPostBridge

  constructor(private readonly client: Database.Database) {
    this.canonical = new CanonicalPostRepository(client)
    this.bindings = new PageTabPostBindingRepository(client)
    this.bridge = new LegacyCanonicalPostBridge(client)

    // Transitional guarantee: callers such as config backup may enumerate canonical
    // posts before asking for a specific Page library. Reconcile legacy writers first
    // so the canonical registry is already complete and deterministic.
    this.bridge.reconcileAllPages()
    this.bridge.syncAllGlobalSets()
  }

  get(pageTabId: number): PageTabPostLibrary {
    const reconciledLegacy = this.bridge.reconcilePage(pageTabId)
    this.bridge.syncAllGlobalSets()
    return this.read(pageTabId, reconciledLegacy)
  }

  save(input: SavePageTabPostLibraryInput): PageTabPostLibrary {
    if (!POST_SELECTION_MODES.includes(input.mode)) throw new Error('Chế độ chọn bài không hợp lệ.')
    const page = this.client.prepare(`
      SELECT id FROM page_tabs WHERE id = ?
    `).get(input.pageTabId)
    if (!page) throw new Error(`Không tìm thấy Page Tab #${input.pageTabId}.`)

    this.bridge.syncAllGlobalSets()

    const normalized = input.posts.map(normalizePost)
    let current = this.bindings.list(input.pageTabId)

    // The pre-cutover renderer did not send postId. Detect a just-duplicated Page
    // before reconciling its copied legacy rows; otherwise those rows would create
    // fresh canonical posts and destroy shared identity.
    const compatibilitySource = this.inferDuplicateSource(input.pageTabId, normalized, current)
    if (!compatibilitySource) {
      this.bridge.reconcilePage(input.pageTabId)
      current = this.bindings.list(input.pageTabId)
    }

    const now = Date.now()
    const transaction = this.client.transaction(() => {
      const desiredPostIds: number[] = []

      normalized.forEach((post, index) => {
        const duplicateBinding = compatibilitySource?.[index]
        const currentBinding = current[index]
        const compatibilityBinding = post.postId === undefined
          ? (duplicateBinding ?? currentBinding)
          : undefined

        // `null` is an explicit request from the canonical UI to create a new post.
        // `undefined` is the old renderer contract, so preserve an existing identity
        // when one can be inferred safely by context/order.
        const requestedPostId = typeof post.postId === 'number'
          ? post.postId
          : post.postId === null
            ? null
            : compatibilityBinding?.postId ?? null

        let binding: ResolvedPostBinding
        if (requestedPostId === null) {
          binding = this.bindings.createAndBind(input.pageTabId, {
            name: post.name,
            variants: post.variants,
            image: post.image
          }, now)
        } else {
          const alreadyBound = this.bindings.list(input.pageTabId).find((item) => item.postId === requestedPostId)
          binding = alreadyBound ?? this.bindings.bindExisting(input.pageTabId, requestedPostId, now)
          const canonical = this.canonical.require(requestedPostId)
          const overrides = duplicateBinding?.postId === requestedPostId
            ? duplicateBinding.overrides
            : overridePatch(post, canonical)
          binding = this.bindings.updateOverrides(input.pageTabId, requestedPostId, overrides, now)
        }

        if (binding.enabled !== post.enabled) {
          binding = this.bindings.setEnabled(input.pageTabId, binding.postId, post.enabled, now)
        }
        desiredPostIds.push(binding.postId)
      })

      const desired = new Set(desiredPostIds)
      this.bindings.list(input.pageTabId)
        .filter((binding) => !desired.has(binding.postId))
        .forEach((binding) => this.bindings.unlink(input.pageTabId, binding.postId, now))

      const updateOrder = this.client.prepare(`
        UPDATE page_tab_post_bindings
        SET sort_order = ?, updated_at = ?
        WHERE page_tab_id = ? AND post_id = ?
      `)
      desiredPostIds.forEach((postId, index) => updateOrder.run(index, now, input.pageTabId, postId))

      this.client.prepare(`
        UPDATE page_tabs
        SET post_selection_mode = ?, updated_at = ?
        WHERE id = ?
      `).run(input.mode, now, input.pageTabId)

      this.mirrorLegacyCompatibility(input.pageTabId, input.mode, normalized, now)
    })
    transaction()

    return this.read(input.pageTabId)
  }

  copy(sourcePageTabId: number, targetPageTabId: number): PageTabPostLibrary {
    this.bridge.reconcilePage(sourcePageTabId)
    const source = this.read(sourcePageTabId)
    return this.save({
      pageTabId: targetPageTabId,
      mode: source.mode,
      posts: source.posts.map((post, index) => ({
        postId: post.postId,
        name: post.name,
        enabled: post.enabled,
        sortOrder: index,
        variants: [...post.variants],
        image: { ...post.image }
      }))
    })
  }

  private read(pageTabId: number, legacyFallback = false): PageTabPostLibrary {
    const tab = this.client.prepare(`
      SELECT id, post_selection_mode AS mode
      FROM page_tabs
      WHERE id = ?
    `).get(pageTabId) as { id: number; mode: string } | undefined
    if (!tab) throw new Error(`Không tìm thấy Page Tab #${pageTabId}.`)

    const posts: PageTabPostItem[] = this.bindings.list(pageTabId).map((binding) => {
      const canonical = this.canonical.require(binding.postId)
      return {
        id: binding.bindingId,
        postId: binding.postId,
        name: binding.name,
        enabled: binding.enabled,
        sortOrder: binding.sortOrder,
        variants: [...binding.variants],
        image: { ...binding.image },
        canonical: canonicalSummary(canonical),
        overrides: {
          name: binding.overrides.name,
          variants: binding.overrides.variants === null ? null : [...binding.overrides.variants],
          imageFolderPath: binding.overrides.imageFolderPath,
          imageMode: binding.overrides.imageMode,
          imagesPerPost: binding.overrides.imagesPerPost,
          missingPolicy: binding.overrides.missingPolicy
        }
      }
    })

    return {
      pageTabId,
      mode: POST_SELECTION_MODES.includes(tab.mode as PostSelectionMode) ? tab.mode as PostSelectionMode : 'sequential',
      posts,
      availablePosts: this.canonical.list().map(canonicalSummary),
      legacyFallback
    }
  }

  private inferDuplicateSource(
    targetPageTabId: number,
    input: NormalizedPostInput[],
    current: ResolvedPostBinding[]
  ): ResolvedPostBinding[] | null {
    if (current.length > 0 || input.length === 0 || input.some((post) => post.postId !== undefined)) {
      return null
    }

    const target = this.client.prepare(`
      SELECT id, name, page_uid AS pageUid, created_at AS createdAt
      FROM page_tabs WHERE id = ?
    `).get(targetPageTabId) as { id: number; name: string; pageUid: string; createdAt: number } | undefined
    if (!target || !target.name.endsWith(' Copy')) return null

    const sourceName = target.name.slice(0, -' Copy'.length)
    const source = this.client.prepare(`
      SELECT id
      FROM page_tabs
      WHERE id <> ? AND name = ? AND page_uid = ? AND created_at <= ?
      ORDER BY id DESC
      LIMIT 1
    `).get(targetPageTabId, sourceName, target.pageUid, target.createdAt) as { id: number } | undefined
    if (!source) return null

    this.bridge.reconcilePage(source.id)
    const sourceBindings = this.bindings.list(source.id)
    if (sourceBindings.length !== input.length) return null
    return input.every((post, index) => {
      const sourceBinding = sourceBindings[index]
      return sourceBinding ? matchesResolved(post, sourceBinding) : false
    }) ? sourceBindings : null
  }

  private mirrorLegacyCompatibility(
    pageTabId: number,
    mode: PostSelectionMode,
    posts: NormalizedPostInput[],
    now: number
  ): void {
    const set = this.client.prepare(`
      SELECT id FROM content_sets WHERE page_tab_id = ?
    `).get(pageTabId) as { id: number } | undefined
    if (set) {
      this.client.prepare(`UPDATE content_sets SET mode = ?, updated_at = ? WHERE id = ?`).run(mode, now, set.id)
      this.client.prepare('DELETE FROM content_items WHERE content_set_id = ?').run(set.id)
      const insert = this.client.prepare(`
        INSERT INTO content_items (content_set_id, content, sort_order)
        VALUES (?, ?, ?)
      `)
      posts.forEach((post, index) => {
        const first = post.variants[0]
        if (first) insert.run(set.id, first, index)
      })
    }

    const firstImage = posts.find((post) => post.enabled)?.image ?? posts[0]?.image ?? DEFAULT_PAGE_TAB_IMAGE
    this.client.prepare(`
      UPDATE image_sources
      SET folder_path = ?, mode = ?, images_per_post = ?, missing_policy = ?, updated_at = ?
      WHERE page_tab_id = ?
    `).run(
      firstImage.folderPath,
      firstImage.mode,
      firstImage.imagesPerPost,
      firstImage.missingPolicy,
      now,
      pageTabId
    )
  }
}
