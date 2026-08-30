export const CONTENT_LIBRARY_IMAGE_MODES = ['sequential', 'random', 'filename_match'] as const
export type ContentLibraryImageMode = (typeof CONTENT_LIBRARY_IMAGE_MODES)[number]

export const CONTENT_LIBRARY_MISSING_POLICIES = ['text_only', 'skip'] as const
export type ContentLibraryMissingPolicy = (typeof CONTENT_LIBRARY_MISSING_POLICIES)[number]

export const CANONICAL_CONTENT_LIBRARY_SET_ID = -1

export const CONTENT_LIBRARY_IPC = {
  list: 'content-library:list',
  get: 'content-library:get',
  createSet: 'content-library:set:create',
  renameSet: 'content-library:set:rename',
  deleteSet: 'content-library:set:delete',
  createItem: 'content-library:item:create',
  updateItem: 'content-library:item:update',
  deleteItem: 'content-library:item:delete',
  moveItem: 'content-library:item:move',
  pickImageFolder: 'content-library:pick-image-folder',
  pickTextFile: 'content-library:pick-text-file'
} as const

export interface ContentLibraryImageConfig {
  folderPath: string
  mode: ContentLibraryImageMode
  imagesPerPost: number
  missingPolicy: ContentLibraryMissingPolicy
}

export interface ContentLibraryItemDraft {
  name: string
  enabled: boolean
  variants: string[]
  image: ContentLibraryImageConfig
}

export interface ContentLibraryItem extends ContentLibraryItemDraft {
  id: number
  contentSetId: number
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface ContentLibrarySetSummary {
  id: number
  name: string
  itemCount: number
  enabledCount: number
  createdAt: number
  updatedAt: number
}

export interface ContentLibrarySetDetails extends ContentLibrarySetSummary {
  items: ContentLibraryItem[]
}

export interface ContentLibrarySetIdPayload { id: number }
export interface ContentLibraryItemIdPayload { id: number }
export interface CreateContentLibrarySetInput { name: string }
export interface RenameContentLibrarySetInput { id: number; name: string }
export interface CreateContentLibraryItemInput extends ContentLibraryItemDraft { contentSetId: number }
export interface UpdateContentLibraryItemInput extends ContentLibraryItemDraft { id: number }
export interface MoveContentLibraryItemInput {
  contentSetId: number
  itemId: number
  direction: 'up' | 'down'
}

export interface ContentLibraryTextFileResult {
  path: string
  content: string
}

export const DEFAULT_CONTENT_LIBRARY_IMAGE: ContentLibraryImageConfig = {
  folderPath: '',
  mode: 'sequential',
  imagesPerPost: 1,
  missingPolicy: 'text_only'
}

export function parseContentVariantText(value: string): string[] {
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

export function formatContentVariantText(variants: readonly string[]): string {
  return variants
    .map((variant) => variant.replace(/\\/g, '\\\\').replace(/\|/g, '\\|'))
    .join('\n|\n')
}
