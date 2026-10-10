import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const workspace = readFileSync(
  fileURLToPath(new URL('./ContentLibraryWorkspace.tsx', import.meta.url)),
  'utf8'
)
const styles = readFileSync(
  fileURLToPath(new URL('./contentLibraryCategories.css', import.meta.url)),
  'utf8'
)

describe('Content Library compact editor preview UI', () => {
  it('removes the fixed preview card and launches source/spin previews as a modal', () => {
    expect(workspace).not.toContain('content-library-preview-card')
    expect(workspace).toContain('content-library-preview-launchers')
    expect(workspace).toContain('content-library-preview-modal-backdrop')
    expect(workspace).toContain('onClick={showSourcePreview}')
    expect(workspace).toContain('onClick={spinPreview}')
  })

  it('keeps preview state transient and closes the modal without touching canonical content', () => {
    expect(workspace).toContain('const [preview, setPreview] = useState<PreviewState | null>(null)')
    expect(workspace).toContain('onMouseDown={() => setPreview(null)}')
    expect(workspace).toContain("content: activeVariant ? spinContent(activeVariant)")
  })

  it('locks the editor viewport and gives scrolling to the article textarea', () => {
    expect(styles).toMatch(/\.content-library-editor-body\s*\{[^}]*overflow:\s*hidden/s)
    expect(styles).toMatch(/\.content-library-editor-layout\s*\{[^}]*flex:\s*1/s)
    expect(styles).toMatch(/\.content-library-content-field textarea\s*\{[^}]*overflow:\s*auto/s)
    expect(styles).toMatch(/\.content-library-content-field textarea\s*\{[^}]*resize:\s*none/s)
  })
})
