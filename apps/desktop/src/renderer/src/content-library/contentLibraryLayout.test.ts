import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(
  fileURLToPath(new URL('./contentLibrary.css', import.meta.url)),
  'utf8'
)

describe('Content Library editor layout', () => {
  it('gives the editor the largest desktop column and a large writing/preview surface', () => {
    expect(styles).toContain('minmax(640px, 1.55fr)')
    expect(styles).toContain('min-height: 335px')
    expect(styles).toContain('min-height: 225px')
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
