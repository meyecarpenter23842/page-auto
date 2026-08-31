import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pageSource = readFileSync(new URL('./PageTabsManagerV2.tsx', import.meta.url), 'utf8')
const parityCss = readFileSync(new URL('./pageAccountParity.css', import.meta.url), 'utf8')
const globalSelection = readFileSync(new URL('../recordRowPaintSelection.ts', import.meta.url), 'utf8')
const globalSelectionCss = readFileSync(new URL('../recordRowPaintSelection.css', import.meta.url), 'utf8')

describe('Page account grid parity with Account Manager', () => {
  it('owns mouse-paint selection separately from the enabled checkbox', () => {
    expect(pageSource).toContain('selectedAccountIds')
    expect(pageSource).toContain('beginPageAccountPaint')
    expect(pageSource).toContain('paintPageAccountRow')
    expect(pageSource).toContain('aria-label="Chọn tất cả tài khoản trong Page"')
    expect(pageSource).toContain("className={`${selected ? 'selected-row ' : ''}pt-account-run-row")
    expect(pageSource).toContain('checked={account.enabled}')
    expect(parityCss).toMatch(/\.pt-account-grid tbody tr\.selected-row td,\s*\.pt-account-picker-grid tbody tr\.selected td\s*\{[^}]*background:\s*#d7eaff;/s)
    expect(parityCss).toMatch(/\.pt-account-grid tbody tr\.selected-row:hover td,\s*\.pt-account-picker-grid tbody tr\.selected:hover td\s*\{[^}]*background:\s*#cfe4fb;/s)
  })

  it('uses the live Account Manager status source and presentation labels', () => {
    expect(pageSource).toContain("import { accountStatusLabels } from '../accounts/accountManagerModel'")
    expect(pageSource).toContain('window.pageAuto.listAccounts()')
    expect(pageSource).toContain('const liveStatus = liveAccount?.status ?? account.status')
    expect(pageSource).toContain('>{accountStatusLabels[liveStatus]}</span>')
    expect(pageSource).toContain('ACCOUNT_STATUSES.map')
  })

  it('keeps the generic row controller away from both Page account grids', () => {
    expect(globalSelection).toContain(':not(.pt-account-grid):not(.pt-account-picker-grid)')
    expect(globalSelectionCss).toContain(':not(.pt-account-grid):not(.pt-account-picker-grid)')
  })
})
