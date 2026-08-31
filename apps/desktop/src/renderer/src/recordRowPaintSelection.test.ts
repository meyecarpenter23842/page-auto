import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const controller = readFileSync(new URL('./recordRowPaintSelection.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('./recordRowPaintSelection.css', import.meta.url), 'utf8')
const accountCss = readFileSync(new URL('./accounts/accounts.css', import.meta.url), 'utf8')
const mainEntry = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')

describe('record row mouse-paint selection contract', () => {
  it('uses the same pointer paint lifecycle as Account Manager for every other table', () => {
    expect(controller).toContain("table:not(.account-grid) tbody tr, .quick-page-row")
    expect(controller).toContain("addEventListener('pointerdown'")
    expect(controller).toContain("addEventListener('pointerover'")
    expect(controller).toContain("addEventListener('pointerup'")
    expect(controller).toContain("addEventListener('pointercancel'")
    expect(controller).toContain("addEventListener('blur'")
    expect(controller).toContain('paintValue = !rowPaintSelected(row)')
  })

  it('does not steal pointer-down from controls inside a row', () => {
    expect(controller).toContain('input,button,select,a,textarea')
    expect(controller).toContain('target.closest(INTERACTIVE_SELECTOR)')
  })

  it('syncs a real first-column selection checkbox when the table exposes a Chọn column', () => {
    expect(controller).toContain("headerLabel.includes('chọn')")
    expect(controller).toContain("input[type=\"checkbox\"]")
    expect(controller).toContain('checkbox.click()')
  })

  it('uses the exact Account selected-row fill and no fake hover overlay', () => {
    expect(accountCss).toMatch(/\.account-grid\s+tbody\s+tr\.selected-row\s+td\s*\{[^}]*background:\s*#d7eaff;/s)
    expect(css).toContain('background: #d7eaff !important;')
    expect(css).not.toContain(':hover')
  })

  it('installs the controller once from the renderer entry', () => {
    expect(mainEntry).toContain("import { installRecordRowPaintSelection } from './recordRowPaintSelection'")
    expect(mainEntry).toContain("import './recordRowPaintSelection.css'")
    expect(mainEntry).toContain('installRecordRowPaintSelection()')
    expect(mainEntry).not.toContain('recordRowHover')
  })
})
