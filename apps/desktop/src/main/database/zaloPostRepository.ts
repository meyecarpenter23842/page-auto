import type Database from 'better-sqlite3'
import {
  IMAGE_MODES,
  MISSING_IMAGE_POLICIES,
  POST_SELECTION_MODES,
  type ImageMode,
  type MissingImagePolicy,
  type PostSelectionMode
} from '../../shared/pageTabs'
import type {
  SaveZaloPostLibraryInput,
  ZaloPostLibrary,
  ZaloPostLibraryItem,
  ZaloPostMediaConfig
} from '../../shared/zalo'
import { CanonicalPostRepository } from './canonicalPostRepository'

type BindingRow = {
  bindingId: number
  postId: number
  enabled: number
  sortOrder: number
  imageFolderPathOverride: string | null
  imageModeOverride: string | null
  imagesPerPostOverride: number | null
  missingPolicyOverride: string | null
}

const OWN_MEDIA_MODES = new Set<ImageMode>(['sequential', 'random'])

function parseMode(value: string | null, fallback: ImageMode): ImageMode {
  return IMAGE_MODES.includes(value as ImageMode) ? value as ImageMode : fallback
}

function parseMissing(value: string | null, fallback: MissingImagePolicy): MissingImagePolicy {
  return MISSING_IMAGE_POLICIES.includes(value as MissingImagePolicy) ? value as MissingImagePolicy : fallback
}

function normalizeMedia(input: ZaloPostMediaConfig): ZaloPostMediaConfig {
  if (input.source === 'none') {
    return { source: 'none', folderPath: '', mode: 'sequential', imagesPerTarget: 1, missingPolicy: 'text_only' }
  }
  if (input.source === 'canonical') {
    return { source: 'canonical', folderPath: '', mode: 'sequential', imagesPerTarget: 1, missingPolicy: 'text_only' }
  }
  const folderPath = input.folderPath.trim()
  if (!folderPath) throw new Error('Folder riêng của Bài Zalo chưa được chọn.')
  const mode = OWN_MEDIA_MODES.has(input.mode) ? input.mode : 'sequential'
  const imagesPerTarget = Math.max(1, Math.min(Math.floor(input.imagesPerTarget || 1), 50))
  const missingPolicy = MISSING_IMAGE_POLICIES.includes(input.missingPolicy) ? input.missingPolicy : 'text_only'
  return { source: 'folder', folderPath, mode, imagesPerTarget, missingPolicy }
}

export class ZaloPostRepository {
  private readonly canonical: CanonicalPostRepository

  constructor(private readonly client: Database.Database) {
    this.canonical = new CanonicalPostRepository(client)
  }

  get(): ZaloPostLibrary {
    const config = this.client.prepare(`
      SELECT post_selection_mode AS mode
      FROM zalo_automation_config
      WHERE id = 1
    `).get() as { mode: string } | undefined
    const mode = POST_SELECTION_MODES.includes(config?.mode as PostSelectionMode)
      ? config!.mode as PostSelectionMode
      : 'sequential'

    const rows = this.client.prepare(`
      SELECT
        id AS bindingId, post_id AS postId, enabled, sort_order AS sortOrder,
        image_folder_path_override AS imageFolderPathOverride,
        image_mode_override AS imageModeOverride,
        images_per_post_override AS imagesPerPostOverride,
        missing_policy_override AS missingPolicyOverride
      FROM zalo_post_bindings
      WHERE config_id = 1
      ORDER BY sort_order, id
    `).all() as BindingRow[]

    return {
      mode,
      posts: rows.map((row) => this.toItem(row))
    }
  }

  save(input: SaveZaloPostLibraryInput, now = Date.now()): ZaloPostLibrary {
    const mode: PostSelectionMode = POST_SELECTION_MODES.includes(input.mode) ? input.mode : 'sequential'
    const normalized = input.posts.map((post, index) => {
      if (!Number.isSafeInteger(post.postId) || post.postId <= 0) throw new Error('Post ID Zalo không hợp lệ.')
      return { ...post, sortOrder: index, media: normalizeMedia(post.media) }
    })
    const unique = new Set(normalized.map((post) => post.postId))
    if (unique.size !== normalized.length) throw new Error('Bài Zalo bị trùng liên kết canonical.')

    const transaction = this.client.transaction(() => {
      const current = this.client.prepare(`
        SELECT post_id AS postId FROM zalo_post_bindings WHERE config_id = 1
      `).all() as Array<{ postId: number }>
      const currentIds = new Set(current.map((row) => Number(row.postId)))

      const insert = this.client.prepare(`
        INSERT INTO zalo_post_bindings (
          config_id, post_id, enabled, sort_order,
          name_override, variants_override_json, image_folder_path_override,
          image_mode_override, images_per_post_override, missing_policy_override,
          created_at, updated_at
        ) VALUES (1, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)
      `)
      const update = this.client.prepare(`
        UPDATE zalo_post_bindings
        SET enabled = ?, sort_order = ?,
            name_override = NULL, variants_override_json = NULL,
            image_folder_path_override = ?, image_mode_override = ?,
            images_per_post_override = ?, missing_policy_override = ?, updated_at = ?
        WHERE config_id = 1 AND post_id = ?
      `)

      normalized.forEach((post, index) => {
        this.canonical.require(post.postId)
        const media = post.media
        const folderOverride = media.source === 'canonical' ? null : media.source === 'none' ? '' : media.folderPath
        const modeOverride = media.source === 'folder' ? media.mode : null
        const countOverride = media.source === 'folder' ? media.imagesPerTarget : null
        const missingOverride = media.source === 'folder' ? media.missingPolicy : null
        if (currentIds.has(post.postId)) {
          update.run(post.enabled ? 1 : 0, index, folderOverride, modeOverride, countOverride, missingOverride, now, post.postId)
        } else {
          insert.run(post.postId, post.enabled ? 1 : 0, index, folderOverride, modeOverride, countOverride, missingOverride, now, now)
        }
      })

      const desired = new Set(normalized.map((post) => post.postId))
      current.filter((row) => !desired.has(Number(row.postId))).forEach((row) => {
        this.client.prepare('DELETE FROM zalo_post_bindings WHERE config_id = 1 AND post_id = ?').run(row.postId)
      })

      this.client.prepare(`
        UPDATE zalo_automation_config
        SET post_selection_mode = ?, updated_at = ?
        WHERE id = 1
      `).run(mode, now)
    })
    transaction()
    return this.get()
  }

  private toItem(row: BindingRow): ZaloPostLibraryItem {
    const post = this.canonical.require(Number(row.postId))
    const overrideFolder = row.imageFolderPathOverride
    const media: ZaloPostMediaConfig = overrideFolder === null
      ? {
          source: 'canonical',
          folderPath: post.image.folderPath,
          mode: post.image.mode,
          imagesPerTarget: post.image.imagesPerPost,
          missingPolicy: post.image.missingPolicy
        }
      : overrideFolder === ''
        ? { source: 'none', folderPath: '', mode: 'sequential', imagesPerTarget: 1, missingPolicy: 'text_only' }
        : {
            source: 'folder',
            folderPath: overrideFolder,
            mode: parseMode(row.imageModeOverride, 'sequential'),
            imagesPerTarget: Math.max(1, Number(row.imagesPerPostOverride) || 1),
            missingPolicy: parseMissing(row.missingPolicyOverride, 'text_only')
          }

    return {
      bindingId: Number(row.bindingId),
      postId: post.id,
      name: post.name,
      enabled: Number(row.enabled) === 1,
      sortOrder: Number(row.sortOrder),
      variants: [...post.variants],
      canonicalImage: { ...post.image },
      media
    }
  }
}
