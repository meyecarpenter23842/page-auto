import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const wall = readFileSync(
  fileURLToPath(new URL('./PageWallWorkspace.tsx', import.meta.url)),
  'utf8'
)
const picker = readFileSync(
  fileURLToPath(new URL('../content-library/CanonicalPostPicker.tsx', import.meta.url)),
  'utf8'
)
const pickerStyles = readFileSync(
  fileURLToPath(new URL('../content-library/canonicalPostPicker.css', import.meta.url)),
  'utf8'
)

describe('Page Wall Common Post Picker adapter', () => {
  it('keeps Run Now single-post while Schedule uses a multi-post pool', () => {
    expect(wall).toContain("from '../content-library/CanonicalPostPicker'")
    expect(wall).toContain("mode={pickerTarget === 'schedule' ? 'multiple' : 'single'}")
    expect(wall).toContain("title={pickerTarget === 'schedule' ? 'Chọn bộ bài cho lịch Đăng Tường'")
    expect(wall).toContain('initialSelection={pickerTarget === \'schedule\'')
    expect(wall).toContain('posts: canonical ? [{ postId: canonical.postId')
  })

  it('persists post-pool selection mode without changing the Run Now payload', () => {
    expect(wall).toContain('canonicalPost: canonical')
    expect(wall).toContain("postSelectionMode: 'sequential'")
    expect(wall).toContain("postPool: { mode: scheduleDraft.postSelectionMode, posts: sources }")
    expect(wall).toContain('Cách lấy bài theo từng khung giờ')
    expect(wall).toContain('Dùng hết bộ bài trước khi xáo lại vòng mới.')
  })

  it('keeps manual variant picking out of the Page Wall selection surface', () => {
    expect(wall).not.toContain('<option key={index} value={index}>Biến thể')
    expect(wall).toContain('item?.variants.length || 1')
  })

  it('keeps filename-match media blocked at the picker boundary', () => {
    expect(wall).toContain("getDisabledReason={(item) => item.image.folderPath.trim() && item.image.mode === 'filename_match'")
    expect(picker).toContain('getDisabledReason?: (item: ContentLibraryItem) => string | null')
  })

  it('keeps the common picker above the Page Wall schedule modal', () => {
    expect(pickerStyles).toContain('z-index: 1700')
  })
})
