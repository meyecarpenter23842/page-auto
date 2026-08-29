import type Database from 'better-sqlite3'
import {
  CONTENT_LIBRARY_IMAGE_MODES,
  CONTENT_LIBRARY_MISSING_POLICIES,
  DEFAULT_CONTENT_LIBRARY_IMAGE,
  type ContentLibraryImageConfig,
  type ContentLibraryItem,
  type ContentLibraryItemDraft,
  type ContentLibrarySetDetails,
  type ContentLibrarySetSummary,
  type CreateContentLibraryItemInput,
  type CreateContentLibrarySetInput,
  type MoveContentLibraryItemInput,
  type RenameContentLibrarySetInput,
  type UpdateContentLibraryItemInput
} from '../../shared/contentLibrary'

interface SetRow {
  id: number
  name: string
  createdAt: number
  updatedAt: number
  itemCount?: number
  enabledCount?: number
}

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} không hợp lệ.`)
  return value
}

function normalizedSetName(value: string): string {
  const name = value.trim()
  if (!name) throw new Error('Tên nguồn bài viết không được để trống.')
  if (name.length > 120) throw new Error('Tên nguồn bài viết tối đa 120 ký tự.')
  return name
}

function normalizeVariants(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean)
}

function normalizeImage(image: ContentLibraryImageConfig): ContentLibraryImageConfig {
  if (!CONTENT_LIBRARY_IMAGE_MODES.includes(image.mode)) throw new Error('Chế độ ảnh của bài viết không hợp lệ.')
  if (!CONTENT_LIBRARY_MISSING_POLICIES.includes(image.missingPolicy)) throw new Error('Policy thiếu ảnh không hợp lệ.')
  if (!Number.isInteger(image.imagesPerPost) || image.imagesPerPost < 1 || image.imagesPerPost > 50) {
    throw new Error('Số ảnh mỗi bài phải từ 1 đến 50.')
  }
  return {
    folderPath: image.folderPath.trim(),
    mode: image.mode,
    imagesPerPost: image.imagesPerPost,
    missingPolicy: image.missingPolicy
  }
}

function normalizeItem(input: ContentLibraryItemDraft, fallbackName: string): ContentLibraryItemDraft {
  const variants = normalizeVariants(input.variants)
  const image = normalizeImage(input.image)
  const name = input.name.trim() || fallbackName
  if (name.length > 160) throw new Error('Tên bài viết tối đa 160 ký tự.')
  if (variants.length === 0 && !image.folderPath) {
    throw new Error(`“${name}” cần có nội dung hoặc folder ảnh.`)
  }
  return { name, enabled: input.enabled, variants, image }
}

function parseVariants(raw: unknown, legacyContent: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]')) as unknown
    if (Array.isArray(parsed)) {
      const values = parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
      if (values.length) return values
    }
  } catch {
    // Fall through to the legacy content column.
  }
  const legacy = String(legacyContent ?? '').trim()
  return legacy ? [legacy] : []
}

function itemFromRow(row: Record<string, unknown>): ContentLibraryItem {
  const mode = String(row.imageMode ?? 'sequential')
  const missingPolicy = String(row.missingPolicy ?? 'text_only')
  return {
    id: Number(row.id),
    contentSetId: Number(row.contentSetId),
    name: String(row.name ?? '').trim() || `Bài viết ${Number(row.sortOrder) + 1}`,
    enabled: Number(row.enabled) === 1,
    variants: parseVariants(row.variantsJson, row.content),
    image: {
      folderPath: String(row.imageFolderPath ?? ''),
      mode: CONTENT_LIBRARY_IMAGE_MODES.includes(mode as ContentLibraryImageConfig['mode'])
        ? mode as ContentLibraryImageConfig['mode']
        : DEFAULT_CONTENT_LIBRARY_IMAGE.mode,
      imagesPerPost: Math.max(1, Number(row.imagesPerPost) || 1),
      missingPolicy: CONTENT_LIBRARY_MISSING_POLICIES.includes(missingPolicy as ContentLibraryImageConfig['missingPolicy'])
        ? missingPolicy as ContentLibraryImageConfig['missingPolicy']
        : DEFAULT_CONTENT_LIBRARY_IMAGE.missingPolicy
    },
    sortOrder: Number(row.sortOrder),
    createdAt: Number(row.createdAt) || 0,
    updatedAt: Number(row.updatedAt) || 0
  }
}

export class ContentLibraryRepository {
  constructor(private readonly client: Database.Database) {}

  list(): ContentLibrarySetSummary[] {
    const rows = this.client.prepare(`
      SELECT
        cs.id,
        cs.name,
        cs.created_at AS createdAt,
        cs.updated_at AS updatedAt,
        COUNT(ci.id) AS itemCount,
        COALESCE(SUM(CASE WHEN ci.enabled = 1 THEN 1 ELSE 0 END), 0) AS enabledCount
      FROM content_sets cs
      LEFT JOIN content_items ci ON ci.content_set_id = cs.id
      WHERE cs.page_tab_id IS NULL
      GROUP BY cs.id
      ORDER BY cs.updated_at DESC, cs.id DESC
    `).all() as SetRow[]
    return rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      itemCount: Number(row.itemCount ?? 0),
      enabledCount: Number(row.enabledCount ?? 0),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt)
    }))
  }

  get(id: number): ContentLibrarySetDetails | null {
    positiveId(id, 'Content Set ID')
    const row = this.client.prepare(`
      SELECT id, name, created_at AS createdAt, updated_at AS updatedAt
      FROM content_sets
      WHERE id = ? AND page_tab_id IS NULL
    `).get(id) as SetRow | undefined
    if (!row) return null
    const items = this.client.prepare(`
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
    `).all(id) as Array<Record<string, unknown>>
    const parsedItems = items.map(itemFromRow)
    return {
      id: Number(row.id),
      name: String(row.name),
      itemCount: parsedItems.length,
      enabledCount: parsedItems.filter((item) => item.enabled).length,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
      items: parsedItems
    }
  }

  createSet(input: CreateContentLibrarySetInput, now = Date.now()): ContentLibrarySetDetails {
    const name = normalizedSetName(input.name)
    this.assertUniqueGlobalName(name)
    const result = this.client.prepare(`
      INSERT INTO content_sets (page_tab_id, name, mode, created_at, updated_at)
      VALUES (NULL, ?, 'sequential', ?, ?)
    `).run(name, now, now)
    return this.required(Number(result.lastInsertRowid))
  }

  renameSet(input: RenameContentLibrarySetInput, now = Date.now()): ContentLibrarySetDetails {
    const id = positiveId(input.id, 'Content Set ID')
    this.requireGlobalSet(id)
    const name = normalizedSetName(input.name)
    this.assertUniqueGlobalName(name, id)
    this.client.prepare(`UPDATE content_sets SET name = ?, updated_at = ? WHERE id = ? AND page_tab_id IS NULL`)
      .run(name, now, id)
    return this.required(id)
  }

  deleteSet(id: number): boolean {
    positiveId(id, 'Content Set ID')
    return this.client.prepare('DELETE FROM content_sets WHERE id = ? AND page_tab_id IS NULL').run(id).changes > 0
  }

  createItem(input: CreateContentLibraryItemInput, now = Date.now()): ContentLibrarySetDetails {
    const setId = positiveId(input.contentSetId, 'Content Set ID')
    this.requireGlobalSet(setId)
    const count = this.client.prepare('SELECT COUNT(*) AS count FROM content_items WHERE content_set_id = ?').get(setId) as { count: number }
    const item = normalizeItem(input, `Bài viết ${count.count + 1}`)
    const insert = this.client.prepare(`
      INSERT INTO content_items (
        content_set_id, name, enabled, content, variants_json,
        image_folder_path, image_mode, images_per_post, missing_policy,
        sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insert.run(
      setId,
      item.name,
      item.enabled ? 1 : 0,
      item.variants[0] ?? '',
      JSON.stringify(item.variants),
      item.image.folderPath,
      item.image.mode,
      item.image.imagesPerPost,
      item.image.missingPolicy,
      count.count,
      now,
      now
    )
    this.touch(setId, now)
    return this.required(setId)
  }

  updateItem(input: UpdateContentLibraryItemInput, now = Date.now()): ContentLibrarySetDetails {
    const id = positiveId(input.id, 'Content Item ID')
    const owner = this.globalOwnerForItem(id)
    if (!owner) throw new Error(`Không tìm thấy bài viết #${id} trong Thư viện chung.`)
    const item = normalizeItem(input, `Bài viết ${owner.sortOrder + 1}`)
    this.client.prepare(`
      UPDATE content_items SET
        name = ?, enabled = ?, content = ?, variants_json = ?,
        image_folder_path = ?, image_mode = ?, images_per_post = ?, missing_policy = ?, updated_at = ?
      WHERE id = ?
    `).run(
      item.name,
      item.enabled ? 1 : 0,
      item.variants[0] ?? '',
      JSON.stringify(item.variants),
      item.image.folderPath,
      item.image.mode,
      item.image.imagesPerPost,
      item.image.missingPolicy,
      now,
      id
    )
    this.touch(owner.contentSetId, now)
    return this.required(owner.contentSetId)
  }

  deleteItem(id: number, now = Date.now()): ContentLibrarySetDetails {
    positiveId(id, 'Content Item ID')
    const owner = this.globalOwnerForItem(id)
    if (!owner) throw new Error(`Không tìm thấy bài viết #${id} trong Thư viện chung.`)
    const run = this.client.transaction(() => {
      this.client.prepare('DELETE FROM content_items WHERE id = ?').run(id)
      this.compactOrder(owner.contentSetId)
      this.touch(owner.contentSetId, now)
    })
    run()
    return this.required(owner.contentSetId)
  }

  moveItem(input: MoveContentLibraryItemInput, now = Date.now()): ContentLibrarySetDetails {
    const setId = positiveId(input.contentSetId, 'Content Set ID')
    const itemId = positiveId(input.itemId, 'Content Item ID')
    this.requireGlobalSet(setId)
    const items = this.client.prepare(`
      SELECT id FROM content_items WHERE content_set_id = ? ORDER BY sort_order, id
    `).all(setId) as Array<{ id: number }>
    const index = items.findIndex((item) => Number(item.id) === itemId)
    if (index < 0) throw new Error(`Bài viết #${itemId} không thuộc nguồn đang chọn.`)
    const target = input.direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= items.length) return this.required(setId)
    const reordered = [...items]
    const [moved] = reordered.splice(index, 1)
    if (!moved) return this.required(setId)
    reordered.splice(target, 0, moved)
    const run = this.client.transaction(() => {
      const update = this.client.prepare('UPDATE content_items SET sort_order = ?, updated_at = ? WHERE id = ?')
      reordered.forEach((item, order) => update.run(order, now, item.id))
      this.touch(setId, now)
    })
    run()
    return this.required(setId)
  }

  private required(id: number): ContentLibrarySetDetails {
    const details = this.get(id)
    if (!details) throw new Error(`Không tìm thấy nguồn bài viết #${id}.`)
    return details
  }

  private requireGlobalSet(id: number): void {
    if (!this.client.prepare('SELECT 1 FROM content_sets WHERE id = ? AND page_tab_id IS NULL').get(id)) {
      throw new Error(`Không tìm thấy nguồn bài viết #${id} trong Thư viện chung.`)
    }
  }

  private assertUniqueGlobalName(name: string, exceptId?: number): void {
    const row = exceptId === undefined
      ? this.client.prepare(`SELECT id FROM content_sets WHERE page_tab_id IS NULL AND name = ? COLLATE NOCASE LIMIT 1`).get(name)
      : this.client.prepare(`SELECT id FROM content_sets WHERE page_tab_id IS NULL AND id <> ? AND name = ? COLLATE NOCASE LIMIT 1`).get(exceptId, name)
    if (row) throw new Error(`Nguồn bài viết “${name}” đã tồn tại.`)
  }

  private globalOwnerForItem(id: number): { contentSetId: number; sortOrder: number } | null {
    const row = this.client.prepare(`
      SELECT ci.content_set_id AS contentSetId, ci.sort_order AS sortOrder
      FROM content_items ci
      JOIN content_sets cs ON cs.id = ci.content_set_id
      WHERE ci.id = ? AND cs.page_tab_id IS NULL
    `).get(id) as { contentSetId: number; sortOrder: number } | undefined
    return row ? { contentSetId: Number(row.contentSetId), sortOrder: Number(row.sortOrder) } : null
  }

  private compactOrder(setId: number): void {
    const rows = this.client.prepare('SELECT id FROM content_items WHERE content_set_id = ? ORDER BY sort_order, id').all(setId) as Array<{ id: number }>
    const update = this.client.prepare('UPDATE content_items SET sort_order = ? WHERE id = ?')
    rows.forEach((row, index) => update.run(index, row.id))
  }

  private touch(setId: number, now: number): void {
    this.client.prepare('UPDATE content_sets SET updated_at = ? WHERE id = ? AND page_tab_id IS NULL').run(now, setId)
  }
}
