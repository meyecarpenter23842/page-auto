import type Database from 'better-sqlite3'
import {
  DEFAULT_PAGE_TAB_IMAGE,
  IMAGE_MODES,
  MISSING_IMAGE_POLICIES,
  POST_SELECTION_MODES,
  type ImageMode,
  type MissingImagePolicy,
  type PageTabImageConfig,
  type PageTabPostInput,
  type PageTabPostItem,
  type PageTabPostLibrary,
  type PostSelectionMode,
  type SavePageTabPostLibraryInput
} from '../../shared/pageTabs'

interface LegacyImageRow {
  folderPath: string
  mode: string
  imagesPerPost: number
  missingPolicy: string
}

interface LegacyContentSetRow {
  id: number
  mode: string
}

function normalizeVariants(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean)
}

function normalizeImage(image: PageTabImageConfig): PageTabImageConfig {
  if (!IMAGE_MODES.includes(image.mode)) throw new Error('Chế độ ảnh không hợp lệ.')
  if (!MISSING_IMAGE_POLICIES.includes(image.missingPolicy)) throw new Error('Policy thiếu ảnh không hợp lệ.')
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

function parseVariants(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw)) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
  } catch {
    return []
  }
}

export class PageTabPostRepository {
  constructor(private readonly client: Database.Database) {}

  get(pageTabId: number): PageTabPostLibrary {
    const tab = this.client.prepare(`
      SELECT id, post_selection_mode AS mode
      FROM page_tabs
      WHERE id = ?
    `).get(pageTabId) as { id: number; mode: string } | undefined
    if (!tab) throw new Error(`Không tìm thấy Page Tab #${pageTabId}.`)

    const rows = this.client.prepare(`
      SELECT
        id,
        name,
        enabled,
        variants_json AS variantsJson,
        image_folder_path AS imageFolderPath,
        image_mode AS imageMode,
        images_per_post AS imagesPerPost,
        missing_policy AS missingPolicy,
        sort_order AS sortOrder
      FROM page_tab_posts
      WHERE page_tab_id = ?
      ORDER BY sort_order, id
    `).all(pageTabId) as Array<Record<string, unknown>>

    if (rows.length > 0) {
      return {
        pageTabId,
        mode: POST_SELECTION_MODES.includes(tab.mode as PostSelectionMode) ? tab.mode as PostSelectionMode : 'sequential',
        legacyFallback: false,
        posts: rows.map((row): PageTabPostItem => ({
          id: Number(row.id),
          name: String(row.name),
          enabled: Number(row.enabled) === 1,
          sortOrder: Number(row.sortOrder),
          variants: parseVariants(row.variantsJson),
          image: {
            folderPath: String(row.imageFolderPath ?? ''),
            mode: IMAGE_MODES.includes(String(row.imageMode) as ImageMode) ? String(row.imageMode) as ImageMode : 'random',
            imagesPerPost: Math.max(1, Number(row.imagesPerPost) || 1),
            missingPolicy: MISSING_IMAGE_POLICIES.includes(String(row.missingPolicy) as MissingImagePolicy)
              ? String(row.missingPolicy) as MissingImagePolicy
              : 'text_only'
          }
        }))
      }
    }

    return this.fromLegacy(pageTabId)
  }

  save(input: SavePageTabPostLibraryInput): PageTabPostLibrary {
    if (!POST_SELECTION_MODES.includes(input.mode)) throw new Error('Chế độ chọn bài không hợp lệ.')
    const exists = this.client.prepare('SELECT id FROM page_tabs WHERE id = ?').get(input.pageTabId)
    if (!exists) throw new Error(`Không tìm thấy Page Tab #${input.pageTabId}.`)

    const normalized: PageTabPostInput[] = input.posts.map((post, index) => {
      const variants = normalizeVariants(post.variants)
      const name = post.name.trim() || `Bài viết ${index + 1}`
      if (post.enabled && variants.length === 0) {
        throw new Error(`“${name}” đang bật nhưng chưa có nội dung.`)
      }
      return {
        name,
        enabled: post.enabled,
        sortOrder: index,
        variants,
        image: normalizeImage(post.image)
      }
    })

    const now = Date.now()
    const transaction = this.client.transaction(() => {
      this.client.prepare(`
        UPDATE page_tabs
        SET post_selection_mode = ?, updated_at = ?
        WHERE id = ?
      `).run(input.mode, now, input.pageTabId)

      this.client.prepare('DELETE FROM page_tab_posts WHERE page_tab_id = ?').run(input.pageTabId)
      const insert = this.client.prepare(`
        INSERT INTO page_tab_posts (
          page_tab_id, name, enabled, variants_json,
          image_folder_path, image_mode, images_per_post, missing_policy,
          sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const post of normalized) {
        insert.run(
          input.pageTabId,
          post.name,
          post.enabled ? 1 : 0,
          JSON.stringify(post.variants),
          post.image.folderPath,
          post.image.mode,
          post.image.imagesPerPost,
          post.image.missingPolicy,
          post.sortOrder,
          now,
          now
        )
      }

      // Keep legacy content/image rows in sync for older backups/builds.
      const contentSet = this.client.prepare('SELECT id FROM content_sets WHERE page_tab_id = ?').get(input.pageTabId) as { id: number } | undefined
      if (contentSet) {
        this.client.prepare('UPDATE content_sets SET mode = ?, updated_at = ? WHERE id = ?').run(input.mode, now, contentSet.id)
        this.client.prepare('DELETE FROM content_items WHERE content_set_id = ?').run(contentSet.id)
        const insertLegacy = this.client.prepare('INSERT INTO content_items (content_set_id, content, sort_order) VALUES (?, ?, ?)')
        normalized.forEach((post, index) => {
          const firstVariant = post.variants[0]
          if (firstVariant) insertLegacy.run(contentSet.id, firstVariant, index)
        })
      }

      const firstImage = normalized.find((post) => post.enabled)?.image ?? normalized[0]?.image ?? DEFAULT_PAGE_TAB_IMAGE
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
        input.pageTabId
      )
    })
    transaction()
    return this.get(input.pageTabId)
  }

  copy(sourcePageTabId: number, targetPageTabId: number): PageTabPostLibrary {
    const source = this.get(sourcePageTabId)
    return this.save({
      pageTabId: targetPageTabId,
      mode: source.mode,
      posts: source.posts.map((post, index) => ({
        name: post.name,
        enabled: post.enabled,
        sortOrder: index,
        variants: [...post.variants],
        image: { ...post.image }
      }))
    })
  }

  private fromLegacy(pageTabId: number): PageTabPostLibrary {
    const contentSet = this.client.prepare(`
      SELECT id, mode
      FROM content_sets
      WHERE page_tab_id = ?
    `).get(pageTabId) as LegacyContentSetRow | undefined

    const legacyContent = contentSet
      ? this.client.prepare(`
          SELECT content
          FROM content_items
          WHERE content_set_id = ?
          ORDER BY sort_order, id
        `).all(contentSet.id) as Array<{ content: string }>
      : []

    const imageRow = this.client.prepare(`
      SELECT
        folder_path AS folderPath,
        mode,
        images_per_post AS imagesPerPost,
        missing_policy AS missingPolicy
      FROM image_sources
      WHERE page_tab_id = ?
    `).get(pageTabId) as LegacyImageRow | undefined

    const image: PageTabImageConfig = imageRow
      ? {
          folderPath: String(imageRow.folderPath ?? ''),
          mode: IMAGE_MODES.includes(String(imageRow.mode) as ImageMode) ? String(imageRow.mode) as ImageMode : 'random',
          imagesPerPost: Math.max(1, Number(imageRow.imagesPerPost) || 1),
          missingPolicy: MISSING_IMAGE_POLICIES.includes(String(imageRow.missingPolicy) as MissingImagePolicy)
            ? String(imageRow.missingPolicy) as MissingImagePolicy
            : 'text_only'
        }
      : { ...DEFAULT_PAGE_TAB_IMAGE, mode: 'random' }

    return {
      pageTabId,
      mode: contentSet?.mode === 'random' ? 'random' : 'sequential',
      legacyFallback: true,
      posts: legacyContent
        .map((item) => item.content.trim())
        .filter(Boolean)
        .map((content, index) => ({
          id: -(index + 1),
          name: `Bài viết ${index + 1}`,
          enabled: true,
          sortOrder: index,
          variants: [content],
          image: { ...image }
        }))
    }
  }
}
