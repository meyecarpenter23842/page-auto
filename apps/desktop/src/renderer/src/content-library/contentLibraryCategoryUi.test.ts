import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const workspace = readFileSync(
  fileURLToPath(new URL('./ContentLibraryWorkspace.tsx', import.meta.url)),
  'utf8'
)
const categoryStyles = readFileSync(
  fileURLToPath(new URL('./contentLibraryCategories.css', import.meta.url)),
  'utf8'
)

describe('Content Library canonical category UI', () => {
  it('uses an in-app category form instead of window.prompt', () => {
    expect(workspace).toContain('content-library-category-dialog')
    expect(workspace).toContain('Tạo danh mục')
    expect(workspace).not.toContain('window.prompt')
  })

  it('keeps Tất cả bài viết special and moves one or many canonical items by binding', () => {
    expect(workspace).toContain('CANONICAL_CONTENT_LIBRARY_SET_ID')
    expect(workspace).toContain('checkedItemIds')
    expect(workspace).toContain('targetContentSetId')
    expect(workspace).toContain('Không danh mục')
  })

  it('adds compact desktop controls for multi-select category moves and the modal', () => {
    expect(categoryStyles).toContain('.content-library-category-move')
    expect(categoryStyles).toContain('.content-library-category-dialog-backdrop')
    expect(categoryStyles).toContain('.content-library-check-cell')
  })
})
