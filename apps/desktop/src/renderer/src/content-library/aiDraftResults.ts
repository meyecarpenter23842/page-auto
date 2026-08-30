import type { AiContentAction } from '../../../shared/aiAgents'
import {
  CANONICAL_CONTENT_LIBRARY_SET_ID,
  DEFAULT_CONTENT_LIBRARY_IMAGE,
  formatContentVariantText,
  parseContentVariantText,
  type CreateContentLibraryItemInput
} from '../../../shared/contentLibrary'
import { validateAiPostOutput } from './aiPostOutputFormat'

export const CONTENT_LIBRARY_EXTERNAL_CHANGE_EVENT = 'page-auto:content-library-external-change'

export type AiDraftResultStatus = 'ready' | 'saved' | 'error'
export type AiDraftResultKind = 'single' | 'variant_group'
export type AiDraftBatchMode = 'create' | 'random'

export interface AiRequestContext {
  action: AiContentAction
  postCount: number
}

export function captureAiRequestContext(action: AiContentAction, postCount: number): AiRequestContext {
  return { action, postCount }
}

export interface AiDraftResult {
  id: string
  name: string
  content: string
  kind: AiDraftResultKind
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

function buildRandomDraft(
  posts: readonly string[],
  batchId: string
): AiDraftResult[] {
  if (!posts.length) return []
  return [{
    id: `${batchId}-1`,
    name: 'Bài AI Random',
    content: formatContentVariantText(posts),
    kind: 'variant_group',
    selected: true,
    status: 'ready',
    error: null
  }]
}

export function buildAiDraftBatch(
  value: string,
  expectedCount: number,
  batchId = Date.now().toString(36),
  mode: AiDraftBatchMode = 'create'
): AiDraftBatch {
  const validation = validateAiPostOutput(value, expectedCount)
  const drafts = mode === 'random'
    ? buildRandomDraft(validation.posts, batchId)
    : validation.posts.map((content, index) => ({
        id: `${batchId}-${index + 1}`,
        name: `Bài AI ${index + 1}`,
        content,
        kind: 'single' as const,
        selected: true,
        status: 'ready' as const,
        error: null
      }))

  const message = mode === 'random'
    ? validation.valid
      ? `Đủ ${validation.actualCount} biến thể trong 1 bài Random.`
      : `Yêu cầu ${validation.expectedCount} biến thể nhưng Agent trả ${validation.actualCount}. Khối Random vẫn được giữ thành 1 bài để sửa hoặc lưu một lần.`
    : validation.valid
      ? validation.message
      : `${validation.message} Có thể sửa/lưu riêng các bài hợp lệ đã nhận.`

  return {
    expectedCount: validation.expectedCount,
    actualCount: validation.actualCount,
    valid: validation.valid,
    message,
    drafts
  }
}

export function getAiDraftVariantCount(draft: AiDraftResult): number {
  if (!draft.content.trim()) return 0
  return draft.kind === 'variant_group'
    ? parseContentVariantText(draft.content).length
    : 1
}

export function countSavableAiDrafts(drafts: readonly AiDraftResult[]): number {
  return drafts.filter(
    (draft) => draft.selected && draft.status !== 'saved' && getAiDraftVariantCount(draft) > 0
  ).length
}

export function normalizeAiDraftForSave(
  draft: AiDraftResult,
  fallbackIndex: number
): { name: string; variants: string[] } {
  const variants = draft.kind === 'variant_group'
    ? parseContentVariantText(draft.content)
    : [draft.content.trim()].filter(Boolean)

  return {
    name: draft.name.trim() || (draft.kind === 'variant_group' ? 'Bài AI Random' : `Bài AI ${fallbackIndex + 1}`),
    variants
  }
}

export function createCanonicalContentInput(
  draft: AiDraftResult,
  fallbackIndex: number
): CreateContentLibraryItemInput {
  const normalized = normalizeAiDraftForSave(draft, fallbackIndex)
  return {
    contentSetId: CANONICAL_CONTENT_LIBRARY_SET_ID,
    name: normalized.name,
    enabled: true,
    variants: normalized.variants,
    image: { ...DEFAULT_CONTENT_LIBRARY_IMAGE }
  }
}
