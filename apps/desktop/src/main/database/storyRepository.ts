import type Database from 'better-sqlite3'
import type {
  CreateStoryInput,
  StoryFolderMode,
  StoryMediaKind,
  StoryMediaSourceType,
  StoryRecord,
  UpdateStoryInput
} from '../../shared/story'

interface StoryRow {
  id: number
  name: string
  content: string
  media_source_type: StoryMediaSourceType
  media_path: string
  media_kind: StoryMediaKind
  folder_mode: StoryFolderMode
  link_url: string
  random_background: number
  random_font: number
  created_at: number
  updated_at: number
}

function normalizeName(value: string): string {
  const name = value.trim()
  if (!name) throw new Error('Tên Story không được để trống.')
  if (name.length > 200) throw new Error('Tên Story dài tối đa 200 ký tự.')
  return name
}

function normalizeText(value: string | undefined, max: number, label: string): string {
  const text = value?.trim() ?? ''
  if (text.length > max) throw new Error(`${label} dài tối đa ${max} ký tự.`)
  return text
}

function normalizeSource(value: StoryMediaSourceType | undefined): StoryMediaSourceType {
  return value === 'file' || value === 'folder' ? value : 'none'
}

function normalizeKind(value: StoryMediaKind | undefined): StoryMediaKind {
  return value === 'image' || value === 'video' ? value : 'auto'
}

function normalizeFolderMode(value: StoryFolderMode | undefined): StoryFolderMode {
  return value === 'random' ? 'random' : 'sequential'
}

function validateInput(input: CreateStoryInput) {
  const mediaSourceType = normalizeSource(input.mediaSourceType)
  const mediaPath = normalizeText(input.mediaPath, 2_000, 'Đường dẫn media')
  const content = normalizeText(input.content, 20_000, 'Nội dung')
  const linkUrl = normalizeText(input.linkUrl, 2_000, 'Link')
  if (mediaSourceType !== 'none' && !mediaPath) throw new Error('Story media cần chọn file hoặc folder.')
  if (mediaSourceType === 'none' && !content) throw new Error('Story cần nội dung chữ hoặc media.')
  if (linkUrl && !/^https?:\/\//i.test(linkUrl)) throw new Error('Link Story phải bắt đầu bằng http:// hoặc https://.')
  return {
    name: normalizeName(input.name),
    content,
    mediaSourceType,
    mediaPath: mediaSourceType === 'none' ? '' : mediaPath,
    mediaKind: normalizeKind(input.mediaKind),
    folderMode: normalizeFolderMode(input.folderMode),
    linkUrl,
    randomBackground: Boolean(input.randomBackground),
    randomFont: Boolean(input.randomFont)
  }
}

function mapRow(row: StoryRow): StoryRecord {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    mediaSourceType: row.media_source_type,
    mediaPath: row.media_path,
    mediaKind: row.media_kind,
    folderMode: row.folder_mode,
    linkUrl: row.link_url,
    randomBackground: Boolean(row.random_background),
    randomFont: Boolean(row.random_font),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class StoryRepository {
  constructor(private readonly client: Database.Database) {}

  list(): StoryRecord[] {
    return (this.client.prepare(`
      SELECT id, name, content, media_source_type, media_path, media_kind, folder_mode,
             link_url, random_background, random_font, created_at, updated_at
      FROM story_items
      ORDER BY updated_at DESC, id DESC
    `).all() as StoryRow[]).map(mapRow)
  }

  get(id: number): StoryRecord | null {
    const row = this.client.prepare(`
      SELECT id, name, content, media_source_type, media_path, media_kind, folder_mode,
             link_url, random_background, random_font, created_at, updated_at
      FROM story_items
      WHERE id = ?
    `).get(id) as StoryRow | undefined
    return row ? mapRow(row) : null
  }

  getByIds(ids: readonly number[]): StoryRecord[] {
    const result: StoryRecord[] = []
    for (const id of ids) {
      const story = this.get(id)
      if (story) result.push(story)
    }
    return result
  }

  create(input: CreateStoryInput, now = Date.now()): StoryRecord {
    const value = validateInput(input)
    const result = this.client.prepare(`
      INSERT INTO story_items (
        name, content, media_source_type, media_path, media_kind, folder_mode,
        link_url, random_background, random_font, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.name, value.content, value.mediaSourceType, value.mediaPath, value.mediaKind,
      value.folderMode, value.linkUrl, value.randomBackground ? 1 : 0, value.randomFont ? 1 : 0,
      now, now
    )
    const created = this.get(Number(result.lastInsertRowid))
    if (!created) throw new Error('Không đọc lại được Story vừa tạo.')
    return created
  }

  update(input: UpdateStoryInput, now = Date.now()): StoryRecord {
    if (!Number.isSafeInteger(input.id) || input.id <= 0) throw new Error('Story ID không hợp lệ.')
    if (!this.get(input.id)) throw new Error('Story không còn tồn tại.')
    const value = validateInput(input)
    this.client.prepare(`
      UPDATE story_items
      SET name = ?, content = ?, media_source_type = ?, media_path = ?, media_kind = ?,
          folder_mode = ?, link_url = ?, random_background = ?, random_font = ?, updated_at = ?
      WHERE id = ?
    `).run(
      value.name, value.content, value.mediaSourceType, value.mediaPath, value.mediaKind,
      value.folderMode, value.linkUrl, value.randomBackground ? 1 : 0, value.randomFont ? 1 : 0,
      now, input.id
    )
    return this.get(input.id)!
  }
}
