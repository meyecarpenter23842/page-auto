import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const account = readFileSync(new URL('./AccountManager.tsx', import.meta.url), 'utf8')
const columns = readFileSync(new URL('./AccountColumnManager.tsx', import.meta.url), 'utf8')
const importer = readFileSync(new URL('./AccountImportDialog.tsx', import.meta.url), 'utf8')
const email = readFileSync(new URL('../hotmail/HotmailAuto.tsx', import.meta.url), 'utf8')
const security = readFileSync(new URL('../hotmail/HotmailComboPanel.tsx', import.meta.url), 'utf8')

describe('Account and Email Manager UI batch 3', () => {
  it('keeps management and selected-target actions separate with IPC unchanged', () => {
    expect(account).toContain('account-toolbar-primary')
    expect(account).toContain('account-toolbar-bulk')
    expect(account).toContain('aria-label="Thao tác với tài khoản đã chọn"')
    expect(account).toContain('selectedIds.size')
    expect(account).toContain('window.pageAuto.assignAccountsToGroup')
    expect(account).toContain('window.pageAuto.saveAccountColumnLayout')
    expect(account).toContain('window.pageAuto.deleteAccounts')
  })
  it('supports searched columns, width, order, visibility and reset', () => {
    expect(columns).toContain('aria-label="Tìm cột"')
    expect(columns).toContain('Độ rộng cột')
    expect(columns).toContain('const move =')
    expect(columns).toContain('defaultLayout.widths')
    expect(columns).toContain("event.key === 'Escape'")
  })
  it('does not leak imported secrets in the preview or change update mapping', () => {
    expect(importer).toContain('saveAccountImportLastUsedState')
    expect(importer).toContain('formatImportPreviewCell')
    expect(importer).toContain('rawText,')
    expect(importer).toContain('mapping,')
    expect(account).toContain('Dòng lỗi:')
    expect(account).not.toContain('result.errors[0]?.message')
  })
  it('shows exact Email bulk scope and per-account Security results', () => {
    expect(email).toContain('email-bulk-scope')
    expect(email).toContain('disabled={!hasTargets || actionBusy}')
    expect(email).toContain('Hotmail Security ({selectedIds.length})')
    expect(security).toContain('setLastResults(result.results)')
    expect(security).toContain('lastResults.map')
    expect(security).toContain('Chạy ${selectedIds.length} tài khoản')
  })
})
