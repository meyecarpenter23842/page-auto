import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const picker = readFileSync(
  fileURLToPath(new URL('./CanonicalPostPicker.tsx', import.meta.url)),
  'utf8'
)
const styles = readFileSync(
  fileURLToPath(new URL('./canonicalPostPicker.css', import.meta.url)),
  'utf8'
)

describe('Common Canonical Post Picker foundation', () => {
  it('uses the existing canonical library/category IPC without owning business runtime', () => {
    expect(picker).toContain('listContentLibraries()')
    expect(picker).toContain('getContentLibrary({ id: activeSetId })')
    expect(picker).toContain('CANONICAL_CONTENT_LIBRARY_SET_ID')
    expect(picker).not.toContain('pageWall')
    expect(picker).not.toContain('scheduler')
    expect(picker).not.toContain('worker')
  })

  it('organizes selection as folder then post instead of one flat post list', () => {
    expect(picker).toContain('THƯ MỤC')
    expect(picker).toContain('canonical-post-picker-folders')
    expect(picker).toContain('canonical-post-picker-posts')
    expect(picker).toContain('Tìm tên hoặc nội dung trong thư mục')
    expect(styles).toContain('grid-template-columns: 230px minmax(0, 1fr)')
  })

  it('supports consumer-controlled single or multiple post selection without variant picking', () => {
    expect(picker).toContain("export type CanonicalPostPickerMode = 'single' | 'multiple'")
    expect(picker).toContain("type={mode === 'single' ? 'radio' : 'checkbox'}")
    expect(picker).toContain('item.variants.length')
    expect(picker).not.toContain('variantIndex')
    expect(picker).not.toContain('<select')
  })

  it('returns canonical post identity and immutable UI material only', () => {
    expect(picker).toContain('postId: number')
    expect(picker).toContain('sourceSetId: number')
    expect(picker).toContain('item: cloneItem(item)')
    expect(picker).toContain('Math.abs(item.id)')
  })
})
