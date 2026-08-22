export const PAGE_TAB_STATUSES = ['idle', 'scheduled', 'running', 'paused', 'waiting_window', 'stopped', 'error'] as const
export type PageTabStatus = (typeof PAGE_TAB_STATUSES)[number]

export const CONTENT_MODES = ['sequential', 'random', 'round_robin'] as const
export type ContentMode = (typeof CONTENT_MODES)[number]

export const IMAGE_MODES = ['sequential', 'random', 'filename_match'] as const
export type ImageMode = (typeof IMAGE_MODES)[number]

export const MISSING_IMAGE_POLICIES = ['text_only', 'skip'] as const
export type MissingImagePolicy = (typeof MISSING_IMAGE_POLICIES)[number]

export interface PageTabRotationConfig {
  postsPerAccount: number
  postDelayMinSeconds: number
  postDelayMaxSeconds: number
  accountDelayMinSeconds: number
  accountDelayMaxSeconds: number
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

export interface PageTabSaveInput {
  name: string
  pageUid: string
  rotation: PageTabRotationConfig
  accounts: PageTabAccountInput[]
  schedules: PageTabScheduleInput[]
  groupUids: string[]
  contentMode: ContentMode
  contents: string[]
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
  accountDelayMaxSeconds: 900
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
