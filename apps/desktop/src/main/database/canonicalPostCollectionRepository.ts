import type Database from 'better-sqlite3'
import {
  type ContentLibraryItem,
  type ContentLibrarySetDetails,
  type ContentLibrarySetSummary,
  type CreateContentLibraryItemInput,
  type CreateContentLibrarySetInput,
  type RenameContentLibrarySetInput,
  type UpdateContentLibraryItemInput
} from '../../shared/contentLibrary'
import { CanonicalPostRepository, type CanonicalPostRecord } from './canonicalPostRepository'
import { LegacyCanonicalPostBridge } from './legacyCanonicalPostBridge'

interface CollectionRow {
  id: number
  name: string
  createdAt: number
  updatedAt: number
  itemCount?: number
  enabledCount?: number
}

interface CollectionBindingRow {
  postId: number
  enabled: number
  sortOrder: number
}

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} không hợp lệ.`)
  return value
}

function postIdFromVirtualItemId(itemId: number): number {
  if (!Number.isSafeInteger(itemId) || itemId >= 0) throw new Error('Bài viết gốc không hợp lệ.')
  return Math.abs(itemId)
}

function normalizeCategoryName(value: string): string {
  const name = value.trim()
  if (!name) throw new Error('Tên danh mục không được để trống.')
  if (name.length > 120) throw new Error('Tên danh mục tối đa 120 ký tự.')
  return name
}

function itemFromPost(
  post: CanonicalPostRecord,
  collectionId: number,
  enabled: boolean,
  sortOrder: number
): ContentLibraryItem {
  return {
    id: -post.id,
    contentSetId: collectionId,
    name: post.name,
    enabled,
    variants: [...post.variants],
    image: { ...post.image },
    sortOrder,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt
  }
}

export class CanonicalPostCollectionRepository {
  private readonly canonical: CanonicalPostRepository
  private readonly bridge: LegacyCanonicalPostBridge

  constructor(private readonly client: Database.Database) {
    this.canonical = new CanonicalPostRepository(client)
    this.bridge = new LegacyCanonicalPostBridge(client)
  }

  list(): ContentLibrarySetSummary[] {
    this.reconcileUnmappedLegacyCollections()
    const rows = this.client.prepare(`
      SELECT
        c.id,
        c.name,
        c.created_at AS createdAt,
        c.updated_at AS updatedAt,
        COUNT(b.id) AS itemCount,
        COALESCE(SUM(CASE WHEN b.enabled = 1 THEN 1 ELSE 0 END), 0) AS enabledCount
      FROM post_collections c
      LEFT JOIN post_collection_bindings b ON b.collection_id = c.id
      GROUP BY c.id
      ORDER BY c.updated_at DESC, c.id DESC
    `).all() as CollectionRow[]

    return rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      itemCount: Number(row.itemCount ?? 0),
      enabledCount: Number(row.enabledCount ?? 0),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt)
    }))
  }

  get(collectionId: number): ContentLibrarySetDetails | null {
    const id = positiveId(collectionId, 'Danh mục ID')
    this.reconcileUnmappedLegacyCollections()
    const row = this.client.prepare(`
      SELECT id, name, created_at AS createdAt, updated_at AS updatedAt
      FROM post_collections
      WHERE id = ?
    `).get(id) as CollectionRow | undefined
    if (!row) return null

    const bindings = this.client.prepare(`
      SELECT post_id AS postId, enabled, sort_order AS sortOrder
      FROM post_collection_bindings
      WHERE collection_id = ?
      ORDER BY sort_order, id
    `).all(id) as CollectionBindingRow[]

    const items = bindings.flatMap((binding) => {
      const post = this.canonical.get(Number(binding.postId))
      return post
        ? [itemFromPost(post, id, Number(binding.enabled) === 1, Number(binding.sortOrder))]
        : []
    })

    return {
      id,
      name: String(row.name),
      itemCount: items.length,
      enabledCount: items.filter((item) => item.enabled).length,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
      items
    }
  }

  create(input: CreateContentLibrarySetInput, now = Date.now()): ContentLibrarySetDetails {
    this.reconcileUnmappedLegacyCollections()
    const name = normalizeCategoryName(input.name)
    this.assertUniqueName(name)
    const result = this.client.prepare(`
      INSERT INTO post_collections (name, created_at, updated_at)
      VALUES (?, ?, ?)
    `).run(name, now, now)
    return this.require(Number(result.lastInsertRowid))
  }

  rename(input: RenameContentLibrarySetInput, now = Date.now()): ContentLibrarySetDetails {
    const id = positiveId(input.id, 'Danh mục ID')
    this.require(id)
    const name = normalizeCategoryName(input.name)
    this.assertUniqueName(name, id)

    const transaction = this.client.transaction(() => {
      this.client.prepare(`UPDATE post_collections SET name = ?, updated_at = ? WHERE id = ?`).run(name, now, id)
      const legacy = this.legacyContentSetId(id)
      if (legacy !== null) {
        this.client.prepare(`UPDATE content_sets SET name = ?, updated_at = ? WHERE id = ?`).run(name, now, legacy)
      }
    })
    transaction()
    return this.require(id)
  }

  delete(collectionId: number): boolean {
    const id = positiveId(collectionId, 'Danh mục ID')
    if (!this.get(id)) return false
    const legacyContentSetId = this.legacyContentSetId(id)

    const transaction = this.client.transaction(() => {
      if (legacyContentSetId !== null) {
        const legacyItems = this.client.prepare(`
          SELECT id FROM content_items WHERE content_set_id = ?
        `).all(legacyContentSetId) as Array<{ id: number }>
        if (legacyItems.length > 0) {
          const placeholders = legacyItems.map(() => '?').join(', ')
          this.client.prepare(`
            DELETE FROM post_legacy_sources
            WHERE source_kind = 'content_item' AND source_id IN (${placeholders})
          `).run(...legacyItems.map((item) => Number(item.id)))
        }
        this.client.prepare('DELETE FROM content_items WHERE content_set_id = ?').run(legacyContentSetId)
        this.client.prepare('DELETE FROM content_sets WHERE id = ? AND page_tab_id IS NULL').run(legacyContentSetId)
      }
      return this.client.prepare('DELETE FROM post_collections WHERE id = ?').run(id).changes === 1
    })

    return transaction()
  }

  createPost(
    collectionId: number,
    input: CreateContentLibraryItemInput,
    now = Date.now()
  ): ContentLibrarySetDetails {
    const id = this.require(collectionId).id
    const post = this.canonical.create({ name: input.name, variants: input.variants, image: input.image }, now)
    const next = this.nextSortOrder(id)
    this.client.prepare(`
      INSERT INTO post_collection_bindings (collection_id, post_id, enabled, sort_order)
      VALUES (?, ?, ?, ?)
    `).run(id, post.id, input.enabled ? 1 : 0, next)
    this.touch(id, now)
    return this.require(id)
  }

  setItemEnabled(
    collectionId: number,
    itemId: number,
    enabled: boolean,
    now = Date.now()
  ): ContentLibrarySetDetails {
    const id = this.require(collectionId).id
    const postId = postIdFromVirtualItemId(itemId)
    const result = this.client.prepare(`
      UPDATE post_collection_bindings
      SET enabled = ?
      WHERE collection_id = ? AND post_id = ?
    `).run(enabled ? 1 : 0, id, postId)
    if (result.changes > 0) this.touch(id, now)
    return this.require(id)
  }

  moveItem(
    collectionId: number,
    itemId: number,
    direction: 'up' | 'down',
    now = Date.now()
  ): ContentLibrarySetDetails {
    const id = this.require(collectionId).id
    const postId = postIdFromVirtualItemId(itemId)
    const rows = this.client.prepare(`
      SELECT id, post_id AS postId
      FROM post_collection_bindings
      WHERE collection_id = ?
      ORDER BY sort_order, id
    `).all(id) as Array<{ id: number; postId: number }>
    const index = rows.findIndex((row) => Number(row.postId) === postId)
    if (index < 0) throw new Error(`Bài viết #${postId} không thuộc danh mục đang chọn.`)
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= rows.length) return this.require(id)

    const reordered = [...rows]
    const [moved] = reordered.splice(index, 1)
    if (!moved) return this.require(id)
    reordered.splice(target, 0, moved)
    const transaction = this.client.transaction(() => {
      const update = this.client.prepare('UPDATE post_collection_bindings SET sort_order = ? WHERE id = ?')
      reordered.forEach((row, sortOrder) => update.run(sortOrder, row.id))
      this.touch(id, now)
    })
    transaction()
    return this.require(id)
  }

  moveItems(itemIds: readonly number[], targetCollectionId: number | null, now = Date.now()): void {
    const postIds = [...new Set(itemIds.map(postIdFromVirtualItemId))]
    if (postIds.length === 0) throw new Error('Chưa chọn bài viết để chuyển danh mục.')
    postIds.forEach((postId) => this.canonical.require(postId))
    const targetId = targetCollectionId === null ? null : this.require(targetCollectionId).id
    const placeholders = postIds.map(() => '?').join(', ')
    const sourceRows = this.client.prepare(`
      SELECT DISTINCT collection_id AS collectionId
      FROM post_collection_bindings
      WHERE post_id IN (${placeholders})
    `).all(...postIds) as Array<{ collectionId: number }>

    const transaction = this.client.transaction(() => {
      this.client.prepare(`DELETE FROM post_collection_bindings WHERE post_id IN (${placeholders})`).run(...postIds)

      if (targetId !== null) {
        let sortOrder = this.nextSortOrder(targetId)
        const insert = this.client.prepare(`
          INSERT INTO post_collection_bindings (collection_id, post_id, enabled, sort_order)
          VALUES (?, ?, 1, ?)
        `)
        postIds.forEach((postId) => insert.run(targetId, postId, sortOrder++))
      }

      const touched = new Set(sourceRows.map((row) => Number(row.collectionId)))
      if (targetId !== null) touched.add(targetId)
      touched.forEach((collectionId) => this.touch(collectionId, now))
    })
    transaction()
  }

  deleteCanonicalItem(itemId: number): void {
    const postId = postIdFromVirtualItemId(itemId)
    const transaction = this.client.transaction(() => {
      this.client.prepare('DELETE FROM post_collection_bindings WHERE post_id = ?').run(postId)
      this.canonical.delete(postId)
    })
    transaction()
  }

  private require(collectionId: number): ContentLibrarySetDetails {
    const details = this.get(positiveId(collectionId, 'Danh mục ID'))
    if (!details) throw new Error(`Không tìm thấy danh mục #${collectionId}.`)
    return details
  }

  private assertUniqueName(name: string, exceptId?: number): void {
    const row = exceptId === undefined
      ? this.client.prepare('SELECT id FROM post_collections WHERE name = ? COLLATE NOCASE LIMIT 1').get(name)
      : this.client.prepare('SELECT id FROM post_collections WHERE id <> ? AND name = ? COLLATE NOCASE LIMIT 1').get(exceptId, name)
    if (row) throw new Error(`Danh mục “${name}” đã tồn tại.`)
  }

  private nextSortOrder(collectionId: number): number {
    const row = this.client.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
      FROM post_collection_bindings
      WHERE collection_id = ?
    `).get(collectionId) as { next: number }
    return Number(row.next)
  }

  private touch(collectionId: number, now: number): void {
    this.client.prepare('UPDATE post_collections SET updated_at = ? WHERE id = ?').run(now, collectionId)
  }

  private legacyContentSetId(collectionId: number): number | null {
    const row = this.client.prepare(`
      SELECT content_set_id AS contentSetId
      FROM post_collection_legacy_sources
      WHERE collection_id = ?
    `).get(collectionId) as { contentSetId: number } | undefined
    return row ? Number(row.contentSetId) : null
  }

  private reconcileUnmappedLegacyCollections(): void {
    const rows = this.client.prepare(`
      SELECT cs.id
      FROM content_sets cs
      LEFT JOIN post_collection_legacy_sources legacy
        ON legacy.content_set_id = cs.id
      WHERE cs.page_tab_id IS NULL AND legacy.content_set_id IS NULL
      ORDER BY cs.id
    `).all() as Array<{ id: number }>
    rows.forEach((row) => this.bridge.syncGlobalSet(Number(row.id)))
  }
}
