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
  it('uses the shared folder -> post picker for both Run Now and Schedule', () => {
    expect(wall).toContain("from '../content-library/CanonicalPostPicker'")
    expect(wall).toContain('<CanonicalPostPicker')
    expect(wall).toContain("pickerTarget === 'schedule' ? 'Chọn bài cho lịch Đăng Tường'")
    expect(wall).not.toContain('function LibraryPicker')
    expect(wall).not.toContain('Chọn bài này')
  })

  it('removes manual variant picking from the Page Wall selection surface', () => {
    expect(wall).not.toContain('<option key={index} value={index}>Biến thể')
    expect(wall).not.toContain('Biến thể \${draft.post.variantIndex + 1}')
    expect(wall).not.toContain('BT \${source.variantIndex + 1}')
    expect(wall).toContain('\${selectedItem?.variants.length || 1} biến thể')
  })

  it('keeps the existing Page Wall business payload and finite schedule contract intact', () => {
    expect(wall).toContain('canonicalPost: canonical')
    expect(wall).toContain("const source: PageWallPlanPostSource = { kind: 'canonical', postId: scheduleDraft.post.postId, variantIndex: scheduleDraft.post.variantIndex }")
    expect(wall).toContain('variantIndex: ref?.variantIndex ?? 0')
    expect(wall).toContain('const previousIndex = previous?.postId === value.postId ? previous.variantIndex : 0')
  })

  it('keeps filename-match media blocked at the picker boundary without touching runtime', () => {
    expect(wall).toContain("getDisabledReason={(item) => item.image.folderPath.trim() && item.image.mode === 'filename_match'")
    expect(picker).toContain('getDisabledReason?: (item: ContentLibraryItem) => string | null')
    expect(picker).toContain('getDisabledReason?.(item) ?? null')
  })

  it('keeps the common picker above the Page Wall schedule modal', () => {
    expect(pickerStyles).toContain('z-index: 1700')
  })
})
