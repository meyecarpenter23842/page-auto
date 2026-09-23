import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(
  fileURLToPath(new URL('./contentLibrary.css', import.meta.url)),
  'utf8'
)

describe('Content Library editor layout', () => {
  it('keeps the editor largest while giving the post list more room for names', () => {
    expect(styles).toContain('grid-template-columns: 220px minmax(360px, .72fr) minmax(620px, 1.49fr)')
    expect(styles).toContain('.content-library-table th:nth-child(3) { width: auto; }')
    expect(styles).toContain('.content-library-table th:nth-child(4) { width: 68px; }')
    expect(styles).toContain('min-height: 335px')
    expect(styles).toContain('min-height: 225px')
  })

  it('reclaims the Library route header and places compact media settings below the editor', () => {
    expect(styles).toContain('.workspace-content-library > .topbar')
    expect(styles).toContain('display: none;')
    expect(styles).toContain('.content-library-settings-card:first-child')
    expect(styles).toContain('grid-template-columns: minmax(260px, 2.2fr) minmax(120px, .8fr) 92px minmax(120px, .8fr)')
  })

  it('defines a local dark palette instead of leaving light Spin cards in dark mode', () => {
    expect(styles).toContain("html[data-theme='dark'] .content-library-page")
    expect(styles).toContain('--cl-surface: var(--pa-dark-surface)')
    expect(styles).toContain('--cl-accent: #22c55e')
  })

  it('keeps Runtime Spin controls compact instead of rendering the old pool button grid', () => {
    expect(styles).toContain('.content-library-spinbar')
    expect(styles).toContain('.content-library-spin-quick')
    expect(styles).not.toContain('.content-library-spin-pools')
  })
})
