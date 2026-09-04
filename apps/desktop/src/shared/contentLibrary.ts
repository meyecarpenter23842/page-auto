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

function decodeLegacyContentVariantEscapes(value: string): string {
  let result = ''
  let escaped = false

  for (const char of value) {
    if (escaped) {
      if (char === '|' || char === '\\') result += char
      else result += `\\${char}`
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    result += char
  }

  if (escaped) result += '\\'
  return result
}

function nextBraceDepth(value: string, initialDepth: number): number {
  let depth = initialDepth
  for (const char of value) {
    if (char === '{') depth += 1
    else if (char === '}') depth = Math.max(0, depth - 1)
  }
  return depth
}

function encodeContentVariant(value: string): string {
  let depth = 0
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const currentDepth = depth
      depth = nextBraceDepth(line, depth)
      const escapedBackslashes = line.replace(/\\/g, '\\\\')
      return currentDepth === 0 && /^\s*\|\s*$/.test(line)
        ? escapedBackslashes.replace('|', '\\|')
        : escapedBackslashes
    })
    .join('\n')
}

/**
 * Legacy/import text parser only.
 *
 * The editor now manages library variants as separate UI items, so Runtime Spin never
 * needs a separator character there. For backwards-compatible TXT/AI imports, a
 * standalone `|` line still separates library variants, but only at brace depth 0.
 * This preserves multiline Runtime Spin such as `{ Bài 1 \n|\n Bài 2 }` as one post.
 */
export function parseContentVariantText(value: string): string[] {
  const variants: string[] = []
  let lines: string[] = []
  let braceDepth = 0

  const flush = () => {
    const normalized = lines.join('\n').trim()
    if (normalized) variants.push(normalized)
    lines = []
    braceDepth = 0
  }

  for (const rawLine of value.replace(/\r\n/g, '\n').split('\n')) {
    if (braceDepth === 0 && /^\s*\|\s*$/.test(rawLine)) {
      flush()
      continue
    }

    const line = decodeLegacyContentVariantEscapes(rawLine)
    lines.push(line)
    braceDepth = nextBraceDepth(line, braceDepth)
  }

  flush()
  return variants
}

export function formatContentVariantText(variants: readonly string[]): string {
  return variants
    .map(encodeContentVariant)
    .join('\n|\n')
}
