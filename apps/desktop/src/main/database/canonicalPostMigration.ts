import type Database from 'better-sqlite3'

export const CANONICAL_POST_SCHEMA_VERSION = 14
export const CANONICAL_POST_MIGRATION_NAME = 'canonical_post_library'

interface ContentSetRow {
  id: number
  pageTabId: number | null
  name: string
  mode: string
  createdAt: number
  updatedAt: number
}

interface ContentItemRow {
  id: number
  contentSetId: number
  name: string
  enabled: number
  content: string
  variantsJson: string
  imageFolderPath: string
  imageMode: string
  imagesPerPost: number
  missingPolicy: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

interface PagePostRow {
  id: number
  pageTabId: number
  name: string
  enabled: number
  variantsJson: string
  imageFolderPath: string
  imageMode: string
  imagesPerPost: number
  missingPolicy: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

interface ImageSourceRow {
  folderPath: string
  mode: string
  imagesPerPost: number
  missingPolicy: string
}

interface ScenarioActionRow {
  id: number
  scenarioId: number
  actionType: string
  label: string
  configJson: string
  createdAt: number
  updatedAt: number
}

interface CanonicalPostInput {
  name: string
  variants: string[]
  imageFolderPath: string
  imageMode: string
  imagesPerPost: number
  missingPolicy: string
  createdAt: number
  updatedAt: number
}

interface CanonicalBindingRef {
  postId: number
  enabled: boolean
  sortOrder: number
}

const imageModes = new Set(['sequential', 'random', 'filename_match'])
const missingPolicies = new Set(['text_only', 'skip'])

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = raw.trim() ? JSON.parse(raw) as unknown : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function parseVariants(raw: unknown, fallback = ''): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]')) as unknown
    if (Array.isArray(parsed)) {
      const values = parsed
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
      if (values.length) return values
    }
  } catch {
    // Fall through to the legacy single-content value.
  }
  const normalized = fallback.trim()
  return normalized ? [normalized] : []
}

function parseInlinePostVariants(value: string): string[] {
  const variants: string[] = []
  let buffer = ''
  let escaped = false

  for (const char of value.replace(/\r\n/g, '\n')) {
    if (escaped) {
      if (char === '|' || char === '\\') buffer += char
      else buffer += `\\${char}`
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '|') {
      const normalized = buffer.trim()
      if (normalized) variants.push(normalized)
      buffer = ''
      continue
    }
    buffer += char
  }

  if (escaped) buffer += '\\'
  const tail = buffer.trim()
  if (tail) variants.push(tail)
  return variants
}

function normalizedName(value: string, fallback: string): string {
  return value.trim() || fallback
}

function normalizedImageMode(value: unknown, fallback: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return imageModes.has(normalized) ? normalized : fallback
}

function normalizedMissingPolicy(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return missingPolicies.has(normalized) ? normalized : 'text_only'
}

function normalizedImagesPerPost(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 1
}

function normalizedTimestamp(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function insertCanonicalPost(
  client: Database.Database,
  input: CanonicalPostInput,
  sourceKind: string,
  sourceId: number
): number {
  const insert = client.prepare(`
    INSERT INTO posts (
      name, variants_json, image_folder_path, image_mode,
      images_per_post, missing_policy, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.name,
    JSON.stringify(input.variants),
    input.imageFolderPath,
    input.imageMode,
    input.imagesPerPost,
    input.missingPolicy,
    input.createdAt,
    input.updatedAt
  )
  const postId = Number(insert.lastInsertRowid)
  client.prepare(`
    INSERT INTO post_legacy_sources (source_kind, source_id, post_id)
    VALUES (?, ?, ?)
  `).run(sourceKind, sourceId, postId)
  return postId
}

function contentItemPostInput(item: ContentItemRow, owner: ContentSetRow, now: number): CanonicalPostInput {
  return {
    name: normalizedName(item.name, `Bài viết ${item.sortOrder + 1}`),
    variants: parseVariants(item.variantsJson, item.content),
    imageFolderPath: String(item.imageFolderPath ?? '').trim(),
    imageMode: normalizedImageMode(item.imageMode, 'random'),
    imagesPerPost: normalizedImagesPerPost(item.imagesPerPost),
    missingPolicy: normalizedMissingPolicy(item.missingPolicy),
    createdAt: normalizedTimestamp(item.createdAt, normalizedTimestamp(owner.createdAt, now)),
    updatedAt: normalizedTimestamp(item.updatedAt, normalizedTimestamp(owner.updatedAt, now))
  }
}

function pagePostInput(item: PagePostRow, now: number): CanonicalPostInput {
  return {
    name: normalizedName(item.name, `Bài viết ${item.sortOrder + 1}`),
    variants: parseVariants(item.variantsJson),
    imageFolderPath: String(item.imageFolderPath ?? '').trim(),
    imageMode: normalizedImageMode(item.imageMode, 'random'),
    imagesPerPost: normalizedImagesPerPost(item.imagesPerPost),
    missingPolicy: normalizedMissingPolicy(item.missingPolicy),
    createdAt: normalizedTimestamp(item.createdAt, now),
    updatedAt: normalizedTimestamp(item.updatedAt, now)
  }
}

function legacyPagePostInput(
  item: ContentItemRow,
  owner: ContentSetRow,
  image: ImageSourceRow | undefined,
  now: number
): CanonicalPostInput {
  return {
    name: `Bài viết ${item.sortOrder + 1}`,
    variants: parseVariants(item.variantsJson, item.content),
    imageFolderPath: String(image?.folderPath ?? '').trim(),
    imageMode: normalizedImageMode(image?.mode, 'random'),
    imagesPerPost: normalizedImagesPerPost(image?.imagesPerPost),
    missingPolicy: normalizedMissingPolicy(image?.missingPolicy),
    createdAt: normalizedTimestamp(item.createdAt, normalizedTimestamp(owner.createdAt, now)),
    updatedAt: normalizedTimestamp(item.updatedAt, normalizedTimestamp(owner.updatedAt, now))
  }
}

export function applyCanonicalPostMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const exists = client.prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?')
      .get(CANONICAL_POST_SCHEMA_VERSION)
    if (exists) return

    client.exec(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        name TEXT NOT NULL,
        variants_json TEXT NOT NULL DEFAULT '[]',
        image_folder_path TEXT NOT NULL DEFAULT '',
        image_mode TEXT NOT NULL DEFAULT 'random',
        images_per_post INTEGER NOT NULL DEFAULT 1 CHECK (images_per_post > 0),
        missing_policy TEXT NOT NULL DEFAULT 'text_only',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX idx_posts_updated
        ON posts(updated_at DESC, id DESC);

      CREATE TABLE post_collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX idx_post_collections_updated
        ON post_collections(updated_at DESC, id DESC);

      CREATE TABLE post_collection_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        collection_id INTEGER NOT NULL REFERENCES post_collections(id) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE RESTRICT,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        sort_order INTEGER NOT NULL,
        UNIQUE(collection_id, post_id)
      );

      CREATE INDEX idx_post_collection_bindings_order
        ON post_collection_bindings(collection_id, sort_order, id);

      CREATE TABLE page_tab_post_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        page_tab_id INTEGER NOT NULL REFERENCES page_tabs(id) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE RESTRICT,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        sort_order INTEGER NOT NULL,
        name_override TEXT,
        variants_override_json TEXT,
        image_folder_path_override TEXT,
        image_mode_override TEXT,
        images_per_post_override INTEGER CHECK (images_per_post_override IS NULL OR images_per_post_override > 0),
        missing_policy_override TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(page_tab_id, post_id)
      );

      CREATE INDEX idx_page_tab_post_bindings_order
        ON page_tab_post_bindings(page_tab_id, sort_order, id);

      CREATE TABLE scenario_action_post_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        scenario_action_id INTEGER NOT NULL REFERENCES scenario_actions(id) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE RESTRICT,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        sort_order INTEGER NOT NULL,
        name_override TEXT,
        variants_override_json TEXT,
        image_folder_path_override TEXT,
        image_mode_override TEXT,
        images_per_post_override INTEGER CHECK (images_per_post_override IS NULL OR images_per_post_override > 0),
        missing_policy_override TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(scenario_action_id, post_id)
      );

      CREATE INDEX idx_scenario_action_post_bindings_order
        ON scenario_action_post_bindings(scenario_action_id, sort_order, id);

      -- Transitional provenance only. It makes the additive backfill auditable and
      -- gives the later consumer-cutover batch a deterministic legacy -> canonical map.
      CREATE TABLE post_legacy_sources (
        source_kind TEXT NOT NULL,
        source_id INTEGER NOT NULL,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        PRIMARY KEY(source_kind, source_id),
        UNIQUE(post_id)
      );

      CREATE TABLE post_collection_legacy_sources (
        content_set_id INTEGER PRIMARY KEY NOT NULL,
        collection_id INTEGER NOT NULL REFERENCES post_collections(id) ON DELETE CASCADE,
        UNIQUE(collection_id)
      );
    `)

    const now = Date.now()
    const contentSetPosts = new Map<number, CanonicalBindingRef[]>()

    const globalSets = client.prepare(`
      SELECT
        id,
        page_tab_id AS pageTabId,
        name,
        mode,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM content_sets
      WHERE page_tab_id IS NULL
      ORDER BY id
    `).all() as ContentSetRow[]

    const selectContentItems = client.prepare(`
      SELECT
        id,
        content_set_id AS contentSetId,
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
    `)

    for (const set of globalSets) {
      const collection = client.prepare(`
        INSERT INTO post_collections (name, created_at, updated_at)
        VALUES (?, ?, ?)
      `).run(
        set.name,
        normalizedTimestamp(set.createdAt, now),
        normalizedTimestamp(set.updatedAt, now)
      )
      const collectionId = Number(collection.lastInsertRowid)
      client.prepare(`
        INSERT INTO post_collection_legacy_sources (content_set_id, collection_id)
        VALUES (?, ?)
      `).run(set.id, collectionId)

      const items = selectContentItems.all(set.id) as ContentItemRow[]
      const refs: CanonicalBindingRef[] = []
      for (const item of items) {
        const postId = insertCanonicalPost(client, contentItemPostInput(item, set, now), 'content_item', item.id)
        const enabled = Number(item.enabled) === 1
        client.prepare(`
          INSERT INTO post_collection_bindings (collection_id, post_id, enabled, sort_order)
          VALUES (?, ?, ?, ?)
        `).run(collectionId, postId, enabled ? 1 : 0, item.sortOrder)
        refs.push({ postId, enabled, sortOrder: item.sortOrder })
      }
      contentSetPosts.set(set.id, refs)
    }

    const pageTabIds = client.prepare('SELECT id FROM page_tabs ORDER BY id').all() as Array<{ id: number }>
    const selectPagePosts = client.prepare(`
      SELECT
        id,
        page_tab_id AS pageTabId,
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
    `)
    const selectPageLegacySet = client.prepare(`
      SELECT
        id,
        page_tab_id AS pageTabId,
        name,
        mode,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM content_sets
      WHERE page_tab_id = ?
    `)
    const selectPageImage = client.prepare(`
      SELECT
        folder_path AS folderPath,
        mode,
        images_per_post AS imagesPerPost,
        missing_policy AS missingPolicy
      FROM image_sources
      WHERE page_tab_id = ?
    `)
    const insertPageBinding = client.prepare(`
      INSERT INTO page_tab_post_bindings (
        page_tab_id, post_id, enabled, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)

    for (const tab of pageTabIds) {
      const pagePosts = selectPagePosts.all(tab.id) as PagePostRow[]
      if (pagePosts.length) {
        for (const item of pagePosts) {
          const postId = insertCanonicalPost(client, pagePostInput(item, now), 'page_tab_post', item.id)
          insertPageBinding.run(
            tab.id,
            postId,
            Number(item.enabled) === 1 ? 1 : 0,
            item.sortOrder,
            normalizedTimestamp(item.createdAt, now),
            normalizedTimestamp(item.updatedAt, now)
          )
        }
        continue
      }

      const legacySet = selectPageLegacySet.get(tab.id) as ContentSetRow | undefined
      if (!legacySet) continue
      const image = selectPageImage.get(tab.id) as ImageSourceRow | undefined
      const items = selectContentItems.all(legacySet.id) as ContentItemRow[]
      const refs: CanonicalBindingRef[] = []
      for (const item of items) {
        const postId = insertCanonicalPost(
          client,
          legacyPagePostInput(item, legacySet, image, now),
          'content_item',
          item.id
        )
        const createdAt = normalizedTimestamp(item.createdAt, normalizedTimestamp(legacySet.createdAt, now))
        const updatedAt = normalizedTimestamp(item.updatedAt, normalizedTimestamp(legacySet.updatedAt, now))
        insertPageBinding.run(tab.id, postId, 1, item.sortOrder, createdAt, updatedAt)
        refs.push({ postId, enabled: true, sortOrder: item.sortOrder })
      }
      contentSetPosts.set(legacySet.id, refs)

      client.prepare(`
        UPDATE page_tabs
        SET post_selection_mode = ?
        WHERE id = ?
      `).run(legacySet.mode === 'random' ? 'random' : 'sequential', tab.id)
    }

    const actions = client.prepare(`
      SELECT
        id,
        scenario_id AS scenarioId,
        action_type AS actionType,
        label,
        config_json AS configJson,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM scenario_actions
      WHERE action_type IN ('post', 'group_post')
      ORDER BY id
    `).all() as ScenarioActionRow[]
    const insertScenarioBinding = client.prepare(`
      INSERT INTO scenario_action_post_bindings (
        scenario_action_id, post_id, enabled, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)

    for (const action of actions) {
      const config = parseJsonObject(action.configJson)
      if (!config) continue

      if (action.actionType === 'post') {
        const contentSetId = config.contentSetId
        if (typeof contentSetId !== 'number' || !Number.isSafeInteger(contentSetId) || contentSetId <= 0) continue
        const refs = contentSetPosts.get(contentSetId) ?? []
        for (const ref of refs) {
          insertScenarioBinding.run(
            action.id,
            ref.postId,
            ref.enabled ? 1 : 0,
            ref.sortOrder,
            normalizedTimestamp(action.createdAt, now),
            normalizedTimestamp(action.updatedAt, now)
          )
        }
        continue
      }

      const rawContent = typeof config.content === 'string' ? config.content : ''
      const variants = parseInlinePostVariants(rawContent)
      if (!variants.length) continue

      const postId = insertCanonicalPost(client, {
        name: normalizedName(action.label, `Kịch Bản #${action.scenarioId} · Đăng bài nhóm`),
        variants,
        imageFolderPath: typeof config.imageFolderPath === 'string' ? config.imageFolderPath.trim() : '',
        imageMode: normalizedImageMode(config.imageMode, 'sequential'),
        imagesPerPost: normalizedImagesPerPost(config.imagesPerPost),
        missingPolicy: normalizedMissingPolicy(config.missingPolicy),
        createdAt: normalizedTimestamp(action.createdAt, now),
        updatedAt: normalizedTimestamp(action.updatedAt, now)
      }, 'scenario_group_post_action', action.id)
      insertScenarioBinding.run(
        action.id,
        postId,
        1,
        0,
        normalizedTimestamp(action.createdAt, now),
        normalizedTimestamp(action.updatedAt, now)
      )
    }

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(CANONICAL_POST_SCHEMA_VERSION, CANONICAL_POST_MIGRATION_NAME, now)
  })

  migrate()
}
