export const STORY_IPC = {
  list: 'story:list',
  create: 'story:create',
  update: 'story:update',
  pickMediaFile: 'story:pick-media-file',
  pickMediaFolder: 'story:pick-media-folder'
} as const

export type StoryMediaSourceType = 'none' | 'file' | 'folder'
export type StoryMediaKind = 'auto' | 'image' | 'video'
export type StoryFolderMode = 'sequential' | 'random'

export interface StoryRecord {
  id: number
  name: string
  content: string
  mediaSourceType: StoryMediaSourceType
  mediaPath: string
  mediaKind: StoryMediaKind
  folderMode: StoryFolderMode
  linkUrl: string
  randomBackground: boolean
  randomFont: boolean
  createdAt: number
  updatedAt: number
}

export interface CreateStoryInput {
  name: string
  content?: string
  mediaSourceType?: StoryMediaSourceType
  mediaPath?: string
  mediaKind?: StoryMediaKind
  folderMode?: StoryFolderMode
  linkUrl?: string
  randomBackground?: boolean
  randomFont?: boolean
}

export interface UpdateStoryInput extends CreateStoryInput {
  id: number
}

export interface StoryIdPayload {
  id: number
}

export interface StoryRuntimeData {
  stories: StoryRecord[]
}

export function parseStoryIds(value: unknown): number[] {
  if (typeof value !== 'string') return []
  const seen = new Set<number>()
  const result: number[] = []
  for (const part of value.split(',')) {
    const id = Number(part.trim())
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

export function encodeStoryIds(ids: readonly number[]): string {
  return ids
    .filter((id, index) => Number.isSafeInteger(id) && id > 0 && ids.indexOf(id) === index)
    .join(',')
}
