import { describe, expect, it } from 'vitest'
import {
  buildAiDraftBatch,
  countSavableAiDrafts,
  createCanonicalContentInput,
  normalizeAiDraftForSave
} from './aiDraftResults'

describe('aiDraftResults', () => {
  it('builds editable selected drafts from exact Agent output', () => {
    const batch = buildAiDraftBatch('Bài 1\n|\nBài 2\n|\nBài 3', 3, 'batch')
    expect(batch).toMatchObject({ valid: true, actualCount: 3, expectedCount: 3 })
    expect(batch.drafts).toHaveLength(3)
    expect(batch.drafts[0]).toMatchObject({ id: 'batch-1', name: 'Bài AI 1', selected: true, status: 'ready' })
    expect(countSavableAiDrafts(batch.drafts)).toBe(3)
  })

  it('keeps partial output usable while warning about the requested count', () => {
    const batch = buildAiDraftBatch('A\n|\nB', 3, 'partial')
    expect(batch).toMatchObject({ valid: false, actualCount: 2, expectedCount: 3 })
    expect(batch.message).toContain('Có thể sửa/lưu riêng')
    expect(batch.drafts.map((draft) => draft.content)).toEqual(['A', 'B'])
  })

  it('normalizes names/content before canonical save', () => {
    const batch = buildAiDraftBatch('Nội dung', 1, 'save')
    const draft = { ...batch.drafts[0]!, name: '  ', content: '  Nội dung đã sửa  ' }
    expect(normalizeAiDraftForSave(draft, 0)).toEqual({ name: 'Bài AI 1', content: 'Nội dung đã sửa' })
    expect(createCanonicalContentInput(draft, 0)).toEqual({
      contentSetId: -1,
      name: 'Bài AI 1',
      enabled: true,
      variants: ['Nội dung đã sửa'],
      image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
    })
  })

  it('does not count unselected, saved, or blank drafts as savable', () => {
    const batch = buildAiDraftBatch('A\n|\nB\n|\nC\n|\nD', 4, 'filter')
    const [a, b, c, d] = batch.drafts
    expect(countSavableAiDrafts([
      { ...a!, selected: false },
      { ...b!, status: 'saved' },
      { ...c!, content: '   ' },
      d!
    ])).toBe(1)
  })
})
