import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const controller = readFileSync(new URL('./recordRowPaintSelection.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('./recordRowPaintSelection.css', import.meta.url), 'utf8')
const accountCss = readFileSync(new URL('./accounts/accounts.css', import.meta.url), 'utf8')
const mainEntry = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')

describe('record row mouse-paint selection contract', () => {
  it('keeps generic row selection and routes Page run rows to the real enabled checkbox', () => {
    expect(controller).toContain("table:not(.account-grid):not(.pt-account-picker-grid) tbody tr, .quick-page-row")
    expect(controller).toContain("table.pt-account-grid")
    expect(controller).toContain("header.textContent?.trim() === 'Bật'")
    expect(controller).toContain('checkbox.click()')
    expect(controller).toContain('paintValue = !rowPaintSelected(row)')
  })

  it('captures Page run pointer paint before the old row-selection handler can fire', () => {
    expect(controller).toContain("addEventListener('pointerdown', onPointerDown, true)")
    expect(controller).toContain("addEventListener('pointerover', onPointerOver, true)")
    expect(controller).toContain('if (pageAccount) event.stopPropagation()')
    expect(controller).toContain("addEventListener('pointerup'")
    expect(controller).toContain("addEventListener('pointercancel'")
    expect(controller).toContain("addEventListener('blur'")
  })

  it('does not steal pointer-down from controls inside a row', () => {
    expect(controller).toContain('input,button,select,a,textarea')
    expect(controller).toContain('target.closest(INTERACTIVE_SELECTOR)')
  })

  it('shows Page enabled count only and keeps generic selected-row fill unchanged', () => {
    expect(controller).toContain('const summary = `${enabled}/${rows.length} bật`')
    expect(controller).toContain('MutationObserver')
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
