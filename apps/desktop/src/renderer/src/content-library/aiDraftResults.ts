import {
  CANONICAL_CONTENT_LIBRARY_SET_ID,
  DEFAULT_CONTENT_LIBRARY_IMAGE,
  type CreateContentLibraryItemInput
} from '../../../shared/contentLibrary'
import { validateAiPostOutput } from './aiPostOutputFormat'

export const CONTENT_LIBRARY_EXTERNAL_CHANGE_EVENT = 'page-auto:content-library-external-change'

export type AiDraftResultStatus = 'ready' | 'saved' | 'error'

export interface AiDraftResult {
  id: string
  name: string
  content: string
  selected: boolean
  status: AiDraftResultStatus
  error: string | null
}

export interface AiDraftBatch {
  drafts: AiDraftResult[]
  expectedCount: number
  actualCount: number
  valid: boolean
  message: string
}

export function buildAiDraftBatch(value: string, expectedCount: number, batchId = Date.now().toString(36)): AiDraftBatch {
  const validation = validateAiPostOutput(value, expectedCount)
  return {
    expectedCount: validation.expectedCount,
    actualCount: validation.actualCount,
    valid: validation.valid,
    message: validation.valid
      ? validation.message
      : `${validation.message} Có thể sửa/lưu riêng các bài hợp lệ đã nhận.`,
    drafts: validation.posts.map((content, index) => ({
      id: `${batchId}-${index + 1}`,
      name: `Bài AI ${index + 1}`,
      content,
      selected: true,
      status: 'ready',
      error: null
    }))
  }
}

export function countSavableAiDrafts(drafts: readonly AiDraftResult[]): number {
  return drafts.filter((draft) => draft.selected && draft.status !== 'saved' && draft.content.trim()).length
}

export function normalizeAiDraftForSave(draft: AiDraftResult, fallbackIndex: number): { name: string; content: string } {
  return {
    name: draft.name.trim() || `Bài AI ${fallbackIndex + 1}`,
    content: draft.content.trim()
  }
}

export function createCanonicalContentInput(draft: AiDraftResult, fallbackIndex: number): CreateContentLibraryItemInput {
  const normalized = normalizeAiDraftForSave(draft, fallbackIndex)
  return {
    contentSetId: CANONICAL_CONTENT_LIBRARY_SET_ID,
    name: normalized.name,
    enabled: true,
    variants: [normalized.content],
    image: { ...DEFAULT_CONTENT_LIBRARY_IMAGE }
  }
}
