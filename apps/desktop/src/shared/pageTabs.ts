export const PAGE_TAB_STATUSES = ['idle', 'scheduled', 'running', 'paused', 'waiting_window', 'stopped', 'error'] as const
export type PageTabStatus = (typeof PAGE_TAB_STATUSES)[number]

export const CONTENT_MODES = ['sequential', 'random', 'round_robin'] as const
export type ContentMode = (typeof CONTENT_MODES)[number]

export const IMAGE_MODES = ['sequential', 'random', 'filename_match'] as const
export type ImageMode = (typeof IMAGE_MODES)[number]

export const MISSING_IMAGE_POLICIES = ['text_only', 'skip'] as const
export type MissingImagePolicy = (typeof MISSING_IMAGE_POLICIES)[number]

export const POST_SELECTION_MODES = ['sequential', 'random'] as const
export type PostSelectionMode = (typeof POST_SELECTION_MODES)[number]

export const ACCOUNT_ORDER_MODES = ['sequential', 'random'] as const
export type AccountOrderMode = (typeof ACCOUNT_ORDER_MODES)[number]

export function parsePostVariantText(value: string): string[] {
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

export function formatPostVariantText(variants: string[]): string {
  return variants
    .map((variant) => variant.replace(/\\/g, '\\\\').replace(/\|/g, '\\|'))
    .join('\n|\n')
}

export interface PageTabRotationConfig {
  postsPerAccount: number
  postDelayMinSeconds: number
  postDelayMaxSeconds: number
  accountDelayMinSeconds: number
  accountDelayMaxSeconds: number
  /** Backward compatible for snapshots/configs created before account-order support. */
  accountOrderMode?: AccountOrderMode
}

export interface PageTabAccountInput {
  accountId: number
  enabled: boolean
  sortOrder: number
  postsPerTurn: number | null
}

export interface PageTabAccountRef extends PageTabAccountInput {
  uid: string
  name: string | null
  status: string
  category: string | null
}

export interface PageTabScheduleInput {
  dayOfWeek: number
  startMinute: number
  endMinute: number
  enabled: boolean
  sortOrder: number
}

export interface PageTabSchedule extends PageTabScheduleInput {
  id: number
}

export interface PageTabImageConfig {
  folderPath: string
  mode: ImageMode
  imagesPerPost: number
  missingPolicy: MissingImagePolicy
}

export interface CanonicalPostSummary {
  postId: number
  name: string
  variants: string[]
  image: PageTabImageConfig
  createdAt: number
  updatedAt: number
}

export interface PageTabPostBindingOverrides {
  name: string | null
  variants: string[] | null
  imageFolderPath: string | null
  imageMode: ImageMode | null
  imagesPerPost: number | null
  missingPolicy: MissingImagePolicy | null
}

export interface PageTabPostInput {
  name: string
  enabled: boolean
  sortOrder: number
  variants: string[]
  image: PageTabImageConfig
}

export interface PageTabPostItem extends PageTabPostInput {
  /** Binding row ID. Kept as `id` for renderer compatibility. */
  id: number
  /** Canonical post identity shared across Page/Scenario contexts. */
  postId: number
  canonical: CanonicalPostSummary
  overrides: PageTabPostBindingOverrides
}

export interface PageTabPostLibrary {
  pageTabId: number
  mode: PostSelectionMode
  /** Only posts currently bound to this Page. */
  posts: PageTabPostItem[]
  /** Full canonical store used by “Chọn từ thư viện”. */
  availablePosts: CanonicalPostSummary[]
  /** Transitional compatibility flag; canonical UI always returns false after reconciliation. */
  legacyFallback: boolean
}

export interface SavePageTabPostItemInput extends PageTabPostInput {
  /** Existing canonical post to bind/edit; null/undefined creates a new canonical post. */
  postId?: number | null
}

export interface SavePageTabPostLibraryInput {
  pageTabId: number
  mode: PostSelectionMode
  posts: SavePageTabPostItemInput[]
}

export interface PageTabSaveInput {
  name: string
  pageUid: string
  rotation: PageTabRotationConfig
  accounts: PageTabAccountInput[]
  schedules: PageTabScheduleInput[]
  groupUids: string[]
  /** Legacy compatibility. New UI/runtime uses PageTabPostLibrary. */
  contentMode: ContentMode
  /** Legacy compatibility. New UI/runtime uses PageTabPostLibrary. */
  contents: string[]
  /** Legacy compatibility. New UI/runtime uses PageTabPostLibrary. */
  image: PageTabImageConfig
}

export interface PageTabSummary {
  id: number
  name: string
  pageUid: string
  status: PageTabStatus
  accountCount: number
  scheduleCount: number
  groupCount: number
  contentCount: number
  imageFolder: string
  updatedAt: number
}

export interface PageTabConfig extends PageTabSaveInput {
  id: number
  status: PageTabStatus
  createdAt: number
  updatedAt: number
  accounts: PageTabAccountRef[]
  schedules: PageTabSchedule[]
}

export interface CreatePageTabInput {
  name: string
  pageUid: string
}

export interface UpdatePageTabPayload {
  id: number
  config: PageTabSaveInput
}

export interface PageTabIdPayload {
  id: number
}

export interface PickTextFileResult {
  path: string
  content: string
}

export const DEFAULT_PAGE_TAB_ROTATION: PageTabRotationConfig = {
  postsPerAccount: 1,
  postDelayMinSeconds: 180,
  postDelayMaxSeconds: 300,
  accountDelayMinSeconds: 600,
  accountDelayMaxSeconds: 900,
  accountOrderMode: 'sequential'
}

export const DEFAULT_PAGE_TAB_IMAGE: PageTabImageConfig = {
  folderPath: '',
  mode: 'sequential',
  imagesPerPost: 1,
  missingPolicy: 'text_only'
}

export interface ImageFolderInspection {
  exists: boolean
  fileCount: number
}
