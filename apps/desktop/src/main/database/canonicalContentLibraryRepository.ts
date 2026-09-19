import type Database from 'better-sqlite3'
import {
  CANONICAL_CONTENT_LIBRARY_SET_ID,
  type ContentLibraryItem,
  type ContentLibraryItemDraft,
  type ContentLibrarySetDetails,
  type ContentLibrarySetSummary,
  type CreateContentLibraryItemInput,
  type UpdateContentLibraryItemInput
} from '../../shared/contentLibrary'
import { CanonicalPostRepository, type CanonicalPostRecord } from './canonicalPostRepository'
import { LegacyCanonicalPostBridge } from './legacyCanonicalPostBridge'

function virtualItemId(postId: number): number {
  return -postId
}

function postIdFromVirtualItemId(itemId: number): number {
  if (!Number.isSafeInteger(itemId) || itemId >= 0) throw new Error('Bài viết gốc không hợp lệ.')
  return Math.abs(itemId)
}

function itemFromPost(post: CanonicalPostRecord, sortOrder: number): ContentLibraryItem {
  return {
    id: virtualItemId(post.id),
    contentSetId: CANONICAL_CONTENT_LIBRARY_SET_ID,
    name: post.name,
    enabled: true,
    variants: [...post.variants],
    image: { ...post.image },
    sortOrder,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt
  }
}

export class CanonicalContentLibraryRepository {
  private readonly canonical: CanonicalPostRepository
  private readonly bridge: LegacyCanonicalPostBridge

  constructor(private readonly client: Database.Database) {
    this.canonical = new CanonicalPostRepository(client)
    this.bridge = new LegacyCanonicalPostBridge(client)
  }

  summary(): ContentLibrarySetSummary {
    const details = this.get()
    const { items: _items, ...summary } = details
    return summary
  }

  get(): ContentLibrarySetDetails {
    this.reconcileLegacyWriters()
    const posts = this.canonical.list()
    const items = posts.map(itemFromPost)
    return {
      id: CANONICAL_CONTENT_LIBRARY_SET_ID,
      name: 'Tất cả bài viết',
      itemCount: items.length,
      enabledCount: items.length,
      createdAt: posts.length ? Math.min(...posts.map((post) => post.createdAt)) : 0,
      updatedAt: posts[0]?.updatedAt ?? 0,
      items
    }
  }

  create(input: CreateContentLibraryItemInput, now = Date.now()): ContentLibrarySetDetails {
    this.canonical.create({
      name: input.name,
      variants: input.variants,
      image: input.image
    }, now)
    return this.get()
  }

  update(input: UpdateContentLibraryItemInput, now = Date.now()): ContentLibrarySetDetails {
    const postId = postIdFromVirtualItemId(input.id)
    const post = this.canonical.update(postId, {
      name: input.name,
      variants: input.variants,
      image: input.image
    }, now)
    this.mirrorLegacyGlobalSource(postId, {
      name: post.name,
      enabled: input.enabled,
      variants: post.variants,
      image: post.image
    }, now)
    return this.get()
  }

  delete(itemId: number): ContentLibrarySetDetails {
    this.canonical.delete(postIdFromVirtualItemId(itemId))
    return this.get()
  }

  move(): ContentLibrarySetDetails {
    return this.get()
  }

  private reconcileLegacyWriters(): void {
    this.bridge.reconcileAllPages()
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

  private mirrorLegacyGlobalSource(postId: number, input: ContentLibraryItemDraft, now: number): void {
    const rows = this.client.prepare(`
      SELECT source_id AS sourceId
      FROM post_legacy_sources
      WHERE source_kind = 'content_item' AND post_id = ?
    `).all(postId) as Array<{ sourceId: number }>
    if (!rows.length) return

    const updateItem = this.client.prepare(`
      UPDATE content_items
      SET name = ?, content = ?, variants_json = ?, image_folder_path = ?, image_mode = ?,
          images_per_post = ?, missing_policy = ?, updated_at = ?
      WHERE id = ?
    `)
    const touchSet = this.client.prepare(`
      UPDATE content_sets
      SET updated_at = ?
      WHERE id = (SELECT content_set_id FROM content_items WHERE id = ?)
    `)
    const transaction = this.client.transaction(() => {
      for (const row of rows) {
        updateItem.run(
          input.name,
          input.variants[0] ?? '',
          JSON.stringify(input.variants),
          input.image.folderPath,
          input.image.mode,
          input.image.imagesPerPost,
          input.image.missingPolicy,
          now,
          row.sourceId
        )
        touchSet.run(now, row.sourceId)
      }
    })
    transaction()
  }
}
