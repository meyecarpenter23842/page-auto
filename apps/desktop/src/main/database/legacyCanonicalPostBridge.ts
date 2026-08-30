import type Database from 'better-sqlite3'
import {
  IMAGE_MODES,
  MISSING_IMAGE_POLICIES,
  type ImageMode,
  type MissingImagePolicy,
  type PageTabImageConfig
} from '../../shared/pageTabs'

interface LegacyPostRow {
  id: number
  name: string
  enabled: number
  variantsJson: string
  content?: string
  imageFolderPath: string
  imageMode: string
  imagesPerPost: number
  missingPolicy: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

interface LegacySetRow {
  id: number
  name: string
  createdAt: number
  updatedAt: number
}

interface LegacyPostRef {
  postId: number
  enabled: boolean
  sortOrder: number
}

function parseVariants(raw: unknown, fallback = ''): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]')) as unknown
    if (Array.isArray(parsed)) {
      const values = parsed
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
      if (values.length > 0) return values
    }
  } catch {
    // Use legacy single-content fallback below.
  }
  const normalized = fallback.trim()
  return normalized ? [normalized] : []
}

function imageMode(value: unknown): ImageMode {
  const normalized = String(value ?? '') as ImageMode
  return IMAGE_MODES.includes(normalized) ? normalized : 'random'
}

function missingPolicy(value: unknown): MissingImagePolicy {
  const normalized = String(value ?? '') as MissingImagePolicy
  return MISSING_IMAGE_POLICIES.includes(normalized) ? normalized : 'text_only'
}

function imagesPerPost(value: unknown): number {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 1
}

function timestamp(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : fallback
}

function normalizedName(value: unknown, fallback: string): string {
  return String(value ?? '').trim() || fallback
}

export class LegacyCanonicalPostBridge {
  constructor(private readonly client: Database.Database) {}

  syncAllGlobalSets(now = Date.now()): void {
    const rows = this.client.prepare(`
      SELECT id FROM content_sets WHERE page_tab_id IS NULL ORDER BY id
    `).all() as Array<{ id: number }>
    rows.forEach((row) => this.syncGlobalSet(Number(row.id), now))
  }

  syncGlobalSet(contentSetId: number, now = Date.now()): void {
    const set = this.client.prepare(`
      SELECT id, name, created_at AS createdAt, updated_at AS updatedAt
      FROM content_sets
      WHERE id = ? AND page_tab_id IS NULL
    `).get(contentSetId) as LegacySetRow | undefined

    const mapped = this.client.prepare(`
      SELECT collection_id AS collectionId
      FROM post_collection_legacy_sources
      WHERE content_set_id = ?
    `).get(contentSetId) as { collectionId: number } | undefined

    if (!set) {
      if (!mapped) return
      const previousPosts = this.collectionPostIds(mapped.collectionId)
      this.unlinkRemovedScenarioSetPosts(contentSetId, previousPosts)
      this.client.prepare('DELETE FROM post_collections WHERE id = ?').run(mapped.collectionId)
      this.cleanupOrphanLegacyPosts('content_item', previousPosts)
      return
    }

    const transaction = this.client.transaction(() => {
      const collectionId = mapped?.collectionId ?? this.createCollectionForSet(set, now)
      this.client.prepare(`
        UPDATE post_collections
        SET name = ?, updated_at = ?
        WHERE id = ?
      `).run(set.name, timestamp(set.updatedAt, now), collectionId)

      const previousPosts = this.collectionPostIds(collectionId)
      const scenarioActionIds = this.scenarioActionsForSet(contentSetId)
      const scenarioPosts = previousPosts.length === 0 && scenarioActionIds.length > 0
        ? this.scenarioPostIdsForSet(contentSetId)
        : []
      const preferredPosts = previousPosts.length > 0 ? previousPosts : scenarioPosts
      const scenarioCompatibilityOnly = scenarioActionIds.length > 0 && previousPosts.length === 0

      const items = this.client.prepare(`
        SELECT
          id,
          name,
          enabled,
          content,
          variants_json AS variantsJson,
          image_folder_path AS imageFolderPath,
          image_mode AS imageMode,
          images_per_post AS imagesPerPost,
          missing_policy AS missingPolicy,
          sort_order AS sortOrder,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM content_items
        WHERE content_set_id = ?
        ORDER BY sort_order, id
      `).all(contentSetId) as LegacyPostRow[]

      const desired = items.map((item, index): LegacyPostRef => ({
        postId: this.upsertLegacyPost(
          'content_item',
          item,
          now,
          index,
          preferredPosts[index],
          !scenarioCompatibilityOnly
        ),
        enabled: Number(item.enabled) === 1,
        sortOrder: index
      }))
      const desiredIds = new Set(desired.map((item) => item.postId))
      const removedPosts = previousPosts.filter((postId) => !desiredIds.has(postId))

      this.client.prepare('DELETE FROM post_collection_bindings WHERE collection_id = ?').run(collectionId)
      const insertCollectionBinding = this.client.prepare(`
        INSERT INTO post_collection_bindings (collection_id, post_id, enabled, sort_order)
        VALUES (?, ?, ?, ?)
      `)
      desired.forEach((item) => insertCollectionBinding.run(
        collectionId,
        item.postId,
        item.enabled ? 1 : 0,
        item.sortOrder
      ))

      this.syncScenarioSetBindings(contentSetId, desired, removedPosts, now)
      this.cleanupOrphanLegacyPosts('content_item', removedPosts)
    })
    transaction()
  }

  reconcileAllPages(now = Date.now()): void {
    const pages = this.client.prepare('SELECT id FROM page_tabs ORDER BY id').all() as Array<{ id: number }>
    pages.forEach((row) => this.reconcilePage(Number(row.id), now))
    this.cleanupStalePageLegacyPosts()
  }

  reconcilePage(pageTabId: number, now = Date.now()): boolean {
    const page = this.client.prepare('SELECT id FROM page_tabs WHERE id = ?').get(pageTabId)
    if (!page) return false

    const canonicalState = this.client.prepare(`
      SELECT
        COUNT(*) AS count,
        COALESCE(MAX(CASE WHEN b.updated_at > p.updated_at THEN b.updated_at ELSE p.updated_at END), 0) AS latest
      FROM page_tab_post_bindings b
      JOIN posts p ON p.id = b.post_id
      WHERE b.page_tab_id = ?
    `).get(pageTabId) as { count: number; latest: number }

    let sourceKind: 'page_tab_post' | 'content_item' = 'page_tab_post'
    let legacyPostMode: 'sequential' | 'random' | null = null
    let legacyRows = this.client.prepare(`
      SELECT
        id,
        name,
        enabled,
        variants_json AS variantsJson,
        image_folder_path AS imageFolderPath,
        image_mode AS imageMode,
        images_per_post AS imagesPerPost,
        missing_policy AS missingPolicy,
        sort_order AS sortOrder,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM page_tab_posts
      WHERE page_tab_id = ?
      ORDER BY sort_order, id
    `).all(pageTabId) as LegacyPostRow[]

    if (legacyRows.length === 0 && Number(canonicalState.count) === 0) {
      const set = this.client.prepare(`
        SELECT id, mode, updated_at AS updatedAt
        FROM content_sets
        WHERE page_tab_id = ?
      `).get(pageTabId) as { id: number; mode: string; updatedAt: number } | undefined
      if (set) {
        const image = this.client.prepare(`
          SELECT
            folder_path AS folderPath,
            mode,
            images_per_post AS imagesPerPost,
            missing_policy AS missingPolicy,
            updated_at AS updatedAt
          FROM image_sources
          WHERE page_tab_id = ?
        `).get(pageTabId) as {
          folderPath: string
          mode: string
          imagesPerPost: number
          missingPolicy: string
          updatedAt: number
        } | undefined
        const rows = this.client.prepare(`
          SELECT
            id,
            name,
            enabled,
            content,
            variants_json AS variantsJson,
            sort_order AS sortOrder,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM content_items
          WHERE content_set_id = ?
          ORDER BY sort_order, id
        `).all(set.id) as Array<{
          id: number
          name: string
          enabled: number
          content: string
          variantsJson: string
          sortOrder: number
          createdAt: number
          updatedAt: number
        }>
        sourceKind = 'content_item'
        legacyPostMode = set.mode === 'random' ? 'random' : 'sequential'
        legacyRows = rows.map((row, index) => ({
          id: Number(row.id),
          name: normalizedName(row.name, `Bài viết ${index + 1}`),
          enabled: Number(row.enabled) === 1 ? 1 : 0,
          content: String(row.content ?? ''),
          variantsJson: String(row.variantsJson ?? '[]'),
          imageFolderPath: String(image?.folderPath ?? ''),
          imageMode: String(image?.mode ?? 'random'),
          imagesPerPost: imagesPerPost(image?.imagesPerPost),
          missingPolicy: String(image?.missingPolicy ?? 'text_only'),
          sortOrder: index,
          createdAt: timestamp(row.createdAt, now),
          updatedAt: Math.max(
            timestamp(row.updatedAt, now),
            timestamp(set.updatedAt, now),
            timestamp(image?.updatedAt, now)
          )
        }))
      }
    }

    if (legacyRows.length === 0) return false
    const latestLegacy = legacyRows.reduce((max, row) => Math.max(max, Number(row.updatedAt) || 0), 0)
    if (Number(canonicalState.count) > 0 && latestLegacy <= Number(canonicalState.latest)) return false

    const transaction = this.client.transaction(() => {
      const desired = legacyRows.map((row, index) => ({
        postId: this.upsertLegacyPost(sourceKind, row, now, index),
        enabled: Number(row.enabled) === 1,
        sortOrder: index,
        createdAt: timestamp(row.createdAt, now),
        updatedAt: timestamp(row.updatedAt, now)
      }))

      this.client.prepare('DELETE FROM page_tab_post_bindings WHERE page_tab_id = ?').run(pageTabId)
      const insert = this.client.prepare(`
        INSERT INTO page_tab_post_bindings (
          page_tab_id, post_id, enabled, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      desired.forEach((item) => insert.run(
        pageTabId,
        item.postId,
        item.enabled ? 1 : 0,
        item.sortOrder,
        item.createdAt,
        item.updatedAt
      ))

      if (legacyPostMode) {
        this.client.prepare(`
          UPDATE page_tabs SET post_selection_mode = ? WHERE id = ?
        `).run(legacyPostMode, pageTabId)
      }
    })
    transaction()
    this.cleanupStalePageLegacyPosts()
    return true
  }

  private createCollectionForSet(set: LegacySetRow, now: number): number {
    const result = this.client.prepare(`
      INSERT INTO post_collections (name, created_at, updated_at)
      VALUES (?, ?, ?)
    `).run(
      set.name,
      timestamp(set.createdAt, now),
      timestamp(set.updatedAt, now)
    )
    const collectionId = Number(result.lastInsertRowid)
    this.client.prepare(`
      INSERT INTO post_collection_legacy_sources (content_set_id, collection_id)
      VALUES (?, ?)
    `).run(set.id, collectionId)
    return collectionId
  }

  private collectionPostIds(collectionId: number): number[] {
    const rows = this.client.prepare(`
      SELECT post_id AS postId
      FROM post_collection_bindings
      WHERE collection_id = ?
      ORDER BY sort_order, id
    `).all(collectionId) as Array<{ postId: number }>
    return rows.map((row) => Number(row.postId))
  }

  private upsertLegacyPost(
    sourceKind: 'content_item' | 'page_tab_post',
    row: LegacyPostRow,
    now: number,
    fallbackIndex: number,
    preferredPostId?: number,
    adoptPreferred = true
  ): number {
    const mapped = this.client.prepare(`
      SELECT post_id AS postId
      FROM post_legacy_sources
      WHERE source_kind = ? AND source_id = ?
    `).get(sourceKind, row.id) as { postId: number } | undefined

    const variants = parseVariants(row.variantsJson, row.content ?? '')
    const image: PageTabImageConfig = {
      folderPath: String(row.imageFolderPath ?? '').trim(),
      mode: imageMode(row.imageMode),
      imagesPerPost: imagesPerPost(row.imagesPerPost),
      missingPolicy: missingPolicy(row.missingPolicy)
    }
    const name = normalizedName(row.name, `Bài viết ${fallbackIndex + 1}`)
    const createdAt = timestamp(row.createdAt, now)
    const updatedAt = timestamp(row.updatedAt, now)

    const updatePost = (postId: number) => {
      this.client.prepare(`
        UPDATE posts
        SET name = ?, variants_json = ?, image_folder_path = ?, image_mode = ?,
            images_per_post = ?, missing_policy = ?, updated_at = ?
        WHERE id = ?
      `).run(
        name,
        JSON.stringify(variants),
        image.folderPath,
        image.mode,
        image.imagesPerPost,
        image.missingPolicy,
        updatedAt,
        postId
      )
    }

    if (mapped && this.client.prepare('SELECT 1 FROM posts WHERE id = ?').get(mapped.postId)) {
      updatePost(Number(mapped.postId))
      return Number(mapped.postId)
    }

    if (preferredPostId !== undefined && this.client.prepare('SELECT 1 FROM posts WHERE id = ?').get(preferredPostId)) {
      if (adoptPreferred) {
        this.client.prepare(`
          INSERT OR IGNORE INTO post_legacy_sources (source_kind, source_id, post_id)
          VALUES (?, ?, ?)
        `).run(sourceKind, row.id, preferredPostId)
        updatePost(preferredPostId)
      }
      return preferredPostId
    }

    const insert = this.client.prepare(`
      INSERT INTO posts (
        name, variants_json, image_folder_path, image_mode,
        images_per_post, missing_policy, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      JSON.stringify(variants),
      image.folderPath,
      image.mode,
      image.imagesPerPost,
      image.missingPolicy,
      createdAt,
      updatedAt
    )
    const postId = Number(insert.lastInsertRowid)
    this.client.prepare(`
      INSERT INTO post_legacy_sources (source_kind, source_id, post_id)
      VALUES (?, ?, ?)
    `).run(sourceKind, row.id, postId)
    return postId
  }

  private scenarioActionsForSet(contentSetId: number): number[] {
    const rows = this.client.prepare(`
      SELECT id, config_json AS configJson
      FROM scenario_actions
      WHERE action_type = 'post'
      ORDER BY id
    `).all() as Array<{ id: number; configJson: string }>

    return rows.flatMap((row) => {
      try {
        const parsed = JSON.parse(String(row.configJson ?? '{}')) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
        const value = Number((parsed as Record<string, unknown>).contentSetId)
        return value === contentSetId ? [Number(row.id)] : []
      } catch {
        return []
      }
    })
  }

  private scenarioPostIdsForSet(contentSetId: number): number[] {
    for (const actionId of this.scenarioActionsForSet(contentSetId)) {
      const rows = this.client.prepare(`
        SELECT post_id AS postId
        FROM scenario_action_post_bindings
        WHERE scenario_action_id = ?
        ORDER BY sort_order, id
      `).all(actionId) as Array<{ postId: number }>
      if (rows.length > 0) return rows.map((row) => Number(row.postId))
    }
    return []
  }

  private syncScenarioSetBindings(contentSetId: number, desired: LegacyPostRef[], removedPosts: number[], now: number): void {
    const actionIds = this.scenarioActionsForSet(contentSetId)
    for (const actionId of actionIds) {
      if (removedPosts.length > 0) {
        const placeholders = removedPosts.map(() => '?').join(', ')
        this.client.prepare(`
          DELETE FROM scenario_action_post_bindings
          WHERE scenario_action_id = ? AND post_id IN (${placeholders})
        `).run(actionId, ...removedPosts)
      }

      const insert = this.client.prepare(`
        INSERT OR IGNORE INTO scenario_action_post_bindings (
          scenario_action_id, post_id, enabled, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      const update = this.client.prepare(`
        UPDATE scenario_action_post_bindings
        SET enabled = ?, sort_order = ?, updated_at = ?
        WHERE scenario_action_id = ? AND post_id = ?
      `)
      desired.forEach((item) => {
        insert.run(actionId, item.postId, item.enabled ? 1 : 0, item.sortOrder, now, now)
        update.run(item.enabled ? 1 : 0, item.sortOrder, now, actionId, item.postId)
      })
    }
  }

  private unlinkRemovedScenarioSetPosts(contentSetId: number, removedPosts: number[]): void {
    if (removedPosts.length === 0) return
    const actionIds = this.scenarioActionsForSet(contentSetId)
    const placeholders = removedPosts.map(() => '?').join(', ')
    actionIds.forEach((actionId) => {
      this.client.prepare(`
        DELETE FROM scenario_action_post_bindings
        WHERE scenario_action_id = ? AND post_id IN (${placeholders})
      `).run(actionId, ...removedPosts)
    })
  }

  private cleanupStalePageLegacyPosts(): void {
    const rows = this.client.prepare(`
      SELECT pls.post_id AS postId
      FROM post_legacy_sources pls
      LEFT JOIN page_tab_posts legacy
        ON pls.source_kind = 'page_tab_post' AND legacy.id = pls.source_id
      WHERE pls.source_kind = 'page_tab_post' AND legacy.id IS NULL
    `).all() as Array<{ postId: number }>
    this.cleanupOrphanLegacyPosts('page_tab_post', rows.map((row) => Number(row.postId)))
  }

  private cleanupOrphanLegacyPosts(sourceKind: 'content_item' | 'page_tab_post', postIds: number[]): void {
    for (const postId of new Set(postIds)) {
      const source = this.client.prepare(`
        SELECT source_id AS sourceId
        FROM post_legacy_sources
        WHERE source_kind = ? AND post_id = ?
      `).get(sourceKind, postId) as { sourceId: number } | undefined
      if (!source) continue

      const sourceStillExists = sourceKind === 'content_item'
        ? this.client.prepare('SELECT 1 FROM content_items WHERE id = ?').get(source.sourceId)
        : this.client.prepare('SELECT 1 FROM page_tab_posts WHERE id = ?').get(source.sourceId)
      if (sourceStillExists) continue

      const usage = this.client.prepare(`
        SELECT
          (SELECT COUNT(*) FROM post_collection_bindings WHERE post_id = ?) +
          (SELECT COUNT(*) FROM page_tab_post_bindings WHERE post_id = ?) +
          (SELECT COUNT(*) FROM scenario_action_post_bindings WHERE post_id = ?) AS count
      `).get(postId, postId, postId) as { count: number }
      if (Number(usage.count) === 0) this.client.prepare('DELETE FROM posts WHERE id = ?').run(postId)
    }
  }
}
