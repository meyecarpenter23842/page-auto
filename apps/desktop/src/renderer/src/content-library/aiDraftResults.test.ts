import { describe, expect, it } from 'vitest'
import {
  buildAiDraftBatch,
  captureAiRequestContext,
  countSavableAiDrafts,
  createCanonicalContentInput,
  getAiDraftVariantCount,
  normalizeAiDraftForSave
} from './aiDraftResults'

describe('aiDraftResults', () => {
  it('builds editable selected drafts from exact create output', () => {
    const batch = buildAiDraftBatch('Bài 1\n|\nBài 2\n|\nBài 3', 3, 'batch')
    expect(batch).toMatchObject({ valid: true, actualCount: 3, expectedCount: 3 })
    expect(batch.drafts).toHaveLength(3)
    expect(batch.drafts[0]).toMatchObject({
      id: 'batch-1',
      name: 'Bài AI 1',
      kind: 'single',
      image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' },
      selected: true,
      status: 'ready'
    })
    expect(countSavableAiDrafts(batch.drafts)).toBe(3)
  })

  it('keeps partial create output usable while warning about requested count', () => {
    const batch = buildAiDraftBatch('A\n|\nB', 3, 'partial')
    expect(batch).toMatchObject({ valid: false, actualCount: 2, expectedCount: 3 })
    expect(batch.message).toContain('Có thể sửa/lưu riêng')
    expect(batch.drafts.map((draft) => draft.content)).toEqual(['A', 'B'])
  })

  it('groups Random output into one canonical draft with pipe-separated variants', () => {
    const batch = buildAiDraftBatch('A\n|\nB\n|\nC', 3, 'random', 'random')
    expect(batch).toMatchObject({ valid: true, actualCount: 3, expectedCount: 3 })
    expect(batch.drafts).toHaveLength(1)
    expect(batch.drafts[0]).toMatchObject({
      id: 'random-1',
      name: 'Bài AI Random',
      kind: 'variant_group',
      content: 'A\n|\nB\n|\nC'
    })
    expect(getAiDraftVariantCount(batch.drafts[0]!)).toBe(3)
    expect(countSavableAiDrafts(batch.drafts)).toBe(1)
    expect(createCanonicalContentInput(batch.drafts[0]!, 0).variants).toEqual(['A', 'B', 'C'])
  })

  it('keeps partial Random output as one editable item', () => {
    const batch = buildAiDraftBatch('A\n|\nB', 3, 'partial-random', 'random')
    expect(batch).toMatchObject({ valid: false, actualCount: 2, expectedCount: 3 })
    expect(batch.drafts).toHaveLength(1)
    expect(batch.message).toContain('giữ thành 1 bài')
  })

  it('captures action and count for the request that produced a response', () => {
    let action: 'create' | 'random' = 'random'
    let postCount = 3
    const request = captureAiRequestContext(action, postCount)

    action = 'create'
    postCount = 9

    expect(request).toEqual({ action: 'random', postCount: 3 })
    expect(buildAiDraftBatch('A\n|\nB\n|\nC', request.postCount, 'race', request.action).drafts)
      .toHaveLength(1)
  })

  it('normalizes names/content before canonical single-post save', () => {
    const batch = buildAiDraftBatch('Nội dung', 1, 'save')
    const draft = { ...batch.drafts[0]!, name: '  ', content: '  Nội dung đã sửa  ' }
    expect(normalizeAiDraftForSave(draft, 0)).toEqual({
      name: 'Bài AI 1',
      variants: ['Nội dung đã sửa']
    })
    expect(createCanonicalContentInput(draft, 0)).toEqual({
      contentSetId: -1,
      name: 'Bài AI 1',
      enabled: true,
      variants: ['Nội dung đã sửa'],
      image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
    })
  })

  it('carries preview image setup into the canonical library item', () => {
    const draft = buildAiDraftBatch('Nội dung', 1, 'image-save').drafts[0]!
    draft.image = {
      folderPath: 'F:\\Media\\Giay',
      mode: 'random',
      imagesPerPost: 2,
      missingPolicy: 'skip'
    }

    expect(createCanonicalContentInput(draft, 0).image).toEqual({
      folderPath: 'F:\\Media\\Giay',
      mode: 'random',
      imagesPerPost: 2,
      missingPolicy: 'skip'
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
