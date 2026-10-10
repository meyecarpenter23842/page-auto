import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

const group = source('../page-tabs/PostLibraryModal.tsx')
const scenario = source('../scenarios/ScenarioPostLibraryField.tsx')
const postAction = source('../scenarios/PostActionConfigForm.tsx')
const setField = source('../scenarios/ContentLibraryActionField.tsx')
const zalo = source('../zalo/ZaloBatchPanel.tsx')

describe('Common Canonical Post Picker consumers — Batch 3', () => {
  it('uses the shared folder -> post picker for Page Đăng Nhóm without changing rotation persistence', () => {
    expect(group).toContain("from '../content-library/CanonicalPostPicker'")
    expect(group).toContain('<CanonicalPostPicker mode="multiple" title="Chọn bài cho Đăng Nhóm"')
    expect(group).toContain('disabledPostIds={[...bound]}')
    expect(group).not.toContain('function Picker(')
    expect(group).not.toContain('pt-post-picker-modal')
    expect(group).toContain('POST_SELECTION_MODES.map')
    expect(group).toContain('savePageTabPostLibrary({ pageTabId, mode, posts: next.map(toInput) })')
  })

  it('uses the shared picker for individual Scenario posts while preserving sequential/random action mode', () => {
    expect(scenario).toContain("from '../content-library/CanonicalPostPicker'")
    expect(scenario).toContain('title="Chọn bài cho Kịch Bản"')
    expect(scenario).toContain('mode="multiple"')
    expect(scenario).toContain('disabledPostIds={[...boundPostIds]}')
    expect(scenario).not.toContain('getContentLibrary({ id: CANONICAL_CONTENT_LIBRARY_SET_ID })')
    expect(scenario).not.toContain('pickerRows')
    expect(postAction).toContain("const selectionMode = stringValue(config, 'selectionMode') || 'sequential'")
    expect(postAction).toContain("onChange('selectionMode', 'random')")
  })

  it('uses the shared picker for Zalo canonical binding without changing Zalo post/media persistence', () => {
    expect(zalo).toContain("from '../content-library/CanonicalPostPicker'")
    expect(zalo).toContain('title="Chọn bài cho Zalo"')
    expect(zalo).toContain('mode="multiple"')
    expect(zalo).toContain('disabledPostIds={[...boundPostIds]}')
    expect(zalo).not.toContain('canonicalItems')
    expect(zalo).not.toContain('canonicalLoading')
    expect(zalo).not.toContain('zalo-canonical-list')
    expect(zalo).toContain('window.pageAutoZalo.savePostLibrary')
    expect(zalo).toContain('postId: post.postId, enabled: post.enabled, sortOrder: index, media: { ...post.media }')
    expect(zalo).toContain("source: 'canonical'")
  })

  it('keeps set-level Content Library actions on their existing setId contract', () => {
    expect(setField).toContain('aria-label="Bộ bài viết"')
    expect(setField).toContain('onChange(event.target.value ? Number(event.target.value) : undefined)')
    expect(setField).not.toContain('CanonicalPostPicker')
  })
})
