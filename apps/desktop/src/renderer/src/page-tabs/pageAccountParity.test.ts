import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pageSource = readFileSync(new URL('./PageTabsManagerV2.tsx', import.meta.url), 'utf8')
const parityCss = readFileSync(new URL('./pageAccountParity.css', import.meta.url), 'utf8')

describe('Page account grid parity with Account Manager', () => {
  it('keeps one visible run-state checkbox without relying on the removed global paint controller', () => {
    expect(pageSource).toContain('checked={account.enabled}')
    expect(parityCss).toMatch(/\.pt-account-grid \.pt-account-select\s*\{[^}]*display:\s*none !important;/s)
    expect(parityCss).not.toContain('.pt-account-grid tbody tr.selected-row')
  })

  it('keeps temporary selection only inside the account-picker modal', () => {
    expect(pageSource).toContain('pt-account-picker-grid')
    expect(pageSource).toContain('Đã chọn {selected.size}/{accounts.length}')
    expect(parityCss).toContain('.pt-account-picker-grid tbody tr.selected td')
  })

  it('uses the live Account Manager status source and presentation labels', () => {
    expect(pageSource).toContain("import { accountStatusLabels } from '../accounts/accountManagerModel'")
    expect(pageSource).toContain('window.pageAuto.listAccounts()')
    expect(pageSource).toContain('const liveStatus = liveAccount?.status ?? account.status')
    expect(pageSource).toContain('>{accountStatusLabels[liveStatus]}</span>')
    expect(pageSource).toContain('ACCOUNT_STATUSES.map')
  })
})