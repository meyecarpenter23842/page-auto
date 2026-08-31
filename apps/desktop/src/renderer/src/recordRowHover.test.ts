import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const hoverCss = readFileSync(new URL('./recordRowHover.css', import.meta.url), 'utf8')
const accountCss = readFileSync(new URL('./accounts/accounts.css', import.meta.url), 'utf8')
const mainEntry = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')

describe('record row mouse-hover contract', () => {
  it('adds a non-destructive hover overlay to every data table except the Account reference grid', () => {
    expect(hoverCss).toMatch(/table:not\(\.account-grid\)\s+tbody\s+tr:hover\s*>\s*td\s*\{/)
    expect(hoverCss).toContain('background-image: linear-gradient(')
    expect(hoverCss).toContain('!important')
  })

  it('keeps the Account Manager hover as the visual reference', () => {
    expect(accountCss).toMatch(/\.account-grid\s+tbody\s+tr:hover\s+td\s*\{[^}]*background:\s*#eaf3ff;/s)
  })

  it('covers the table-like quick Page runtime rows too', () => {
    expect(hoverCss).toMatch(/\.quick-page-row:hover\s*\{[^}]*box-shadow:/s)
  })

  it('loads the hover contract after existing renderer layout and feature styles', () => {
    const baseStyles = mainEntry.indexOf("import './styles.css'")
    const workspaceStyles = mainEntry.indexOf("import './mainWorkspaceLayout.css'")
    const hoverStyles = mainEntry.indexOf("import './recordRowHover.css'")

    expect(baseStyles).toBeGreaterThanOrEqual(0)
    expect(workspaceStyles).toBeGreaterThan(baseStyles)
    expect(hoverStyles).toBeGreaterThan(workspaceStyles)
  })
})
