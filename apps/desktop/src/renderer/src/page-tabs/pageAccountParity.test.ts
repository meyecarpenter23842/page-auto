import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pageSource = readFileSync(new URL('./PageTabsManagerV2.tsx', import.meta.url), 'utf8')
const parityCss = readFileSync(new URL('./pageAccountParity.css', import.meta.url), 'utf8')

describe('Page account grid parity with Account Manager', () => {
  it('uses Bật as the only run-state checkbox and range highlight as a separate concept', () => {
    expect(pageSource).toContain('checked={account.enabled}')
    expect(pageSource).toContain('useExcelRowRange')
    expect(pageSource).toContain('AccountSelectionMenu')
    expect(pageSource).not.toContain('selectedAccountIds')
    expect(pageSource).not.toContain('pt-account-select')
    expect(pageSource).not.toContain('beginPageAccountPaint')
    expect(parityCss).not.toContain('.pt-account-grid .pt-account-select')
  })

  it('keeps picker checked state separate from range highlight', () => {
    expect(pageSource).toContain('pt-account-picker-grid')
    expect(pageSource).toContain("checked-row '")
    expect(pageSource).toContain("range-row")
    expect(pageSource).toContain('Đã chọn {selected.size}/{accounts.length}')
    expect(parityCss).not.toContain('#d7eaff')
  })

  it('uses the live Account Manager status source and presentation labels', () => {
    expect(pageSource).toContain("import { accountStatusLabels } from '../accounts/accountManagerModel'")
    expect(pageSource).toContain('window.pageAuto.listAccounts()')
    expect(pageSource).toContain('const liveStatus = liveAccount?.status ?? account.status')
    expect(pageSource).toContain('>{accountStatusLabels[liveStatus]}</span>')
    expect(pageSource).toContain('ACCOUNT_STATUSES.map')
  })
})
