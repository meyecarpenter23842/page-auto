import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./mainWorkspaceLayout.css', import.meta.url), 'utf8')
const mainEntry = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')

describe('main workspace scrolling contract', () => {
  it('keeps the main route frame fixed and delegates scrolling to inner panels', () => {
    expect(css).toContain('.workspace {')
    expect(css).toMatch(/\.workspace\s*\{[^}]*overflow:\s*hidden;/s)
    expect(css).toMatch(/\.account-grid-panel > \.data-grid-wrap\s*\{[^}]*overflow:\s*auto;/s)
    expect(css).toMatch(/\.execution-log-table-wrap\s*\{[^}]*overflow:\s*auto;/s)
    expect(css).toMatch(/\.workspace > \.hero-card\s*\{[^}]*overflow:\s*auto;/s)
    expect(css).toMatch(/\.workspace > \.content-card\s*\{[^}]*overflow:\s*auto;/s)
  })

  it('loads the workspace normalization after the existing renderer styles', () => {
    const baseStyles = mainEntry.indexOf("import './styles.css'")
    const workspaceStyles = mainEntry.indexOf("import './mainWorkspaceLayout.css'")
    expect(baseStyles).toBeGreaterThanOrEqual(0)
    expect(workspaceStyles).toBeGreaterThan(baseStyles)
  })
})
