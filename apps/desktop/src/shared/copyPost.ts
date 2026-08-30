export const COPY_POST_IPC = {
  scan: 'copy-post:scan',
  pickMediaFolder: 'copy-post:pick-media-folder',
  saveSelected: 'copy-post:save-selected'
} as const

export const COPY_POST_TYPES = ['status', 'photo', 'video', 'reel', 'link'] as const
export type CopyPostType = typeof COPY_POST_TYPES[number]
export type CopyPostMediaKind = 'image' | 'video'

export interface CopyPostScanRequest {
  token: string
  sourcesText: string
  fromDate: string
  toDate: string
  limit: number
  randomCount: number
  includeStatus: boolean
  includePhoto: boolean
  includeVideo: boolean
  includeReel: boolean
  includeLink: boolean
  stripLinks: boolean
  stripHashtags: boolean
  ignoreContent: boolean
  prefixText: string
  suffixText: string
  skipCopied: boolean
}

export interface CopyPostMedia {
  key: string
  kind: CopyPostMediaKind
  previewUrl: string | null
  remoteUrl: string | null
  objectId: string | null
}

export interface CopyPostScanItem {
  key: string
  source: string
  sourcePostId: string
  permalink: string
  createdAt: string
  type: CopyPostType
  content: string
  media: CopyPostMedia[]
  alreadyCopied: boolean
}

export interface CopyPostSaveItem {
  source: string
  sourcePostId: string
  permalink: string
  name: string
  content: string
  media: CopyPostMedia[]
}

export interface CopyPostSaveRequest {
  token: string
  destinationFolder: string
  items: CopyPostSaveItem[]
}

export interface CopyPostSaveItemResult {
  sourcePostId: string
  status: 'saved' | 'error'
  canonicalPostId: number | null
  mediaFolder: string | null
  error: string | null
}

export interface CopyPostSaveResult {
  savedCount: number
  failedCount: number
  items: CopyPostSaveItemResult[]
}
