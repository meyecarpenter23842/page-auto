import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const accountSource = readFileSync(new URL('../accounts/AccountManager.tsx', import.meta.url), 'utf8')
const actionWorkspaceSource = readFileSync(new URL('./ActionWorkspace.tsx', import.meta.url), 'utf8')
const changeInfoSource = readFileSync(new URL('./ChangeInfoWorkspace.tsx', import.meta.url), 'utf8')
const registrySource = readFileSync(new URL('./actionWorkspaceRegistry.ts', import.meta.url), 'utf8')

describe('Change Info workspace shell', () => {
  it('opens from Account Manager with canonical account ids and a persisted change_info workspace', () => {
    expect(accountSource).toContain('Sửa thông tin')
    expect(accountSource).toContain("type: 'change_info'")
    expect(accountSource).toContain('selected.map((account) => ({ accountId: account.id, enabled: true }))')
    expect(appSource).toContain('onOpenChangeInfoWorkspace={openChangeInfoWorkspace}')
    expect(appSource).toContain('ACTION_WORKSPACE_OPEN_REQUEST_KEY')
    expect(appSource).toContain("setActiveRoute('actions')")
    expect(actionWorkspaceSource).toContain('window.sessionStorage.getItem(ACTION_WORKSPACE_OPEN_REQUEST_KEY)')
    expect(actionWorkspaceSource).toContain("tab.type === 'change_info'")
    expect(registrySource).toContain("id: 'change_info'")
  })

  it('renders dense account/data-source/preset controls and gates Start on saved audited config', () => {
    expect(changeInfoSource).toContain('Tài khoản chạy')
    expect(changeInfoSource).toContain('change-info-groups')
    expect(changeInfoSource).toContain('change-info-inline-editor')
    expect(changeInfoSource).toContain('aria-label={`Nguồn ${catalog.label}`}')
    expect(changeInfoSource).toContain('window.pageAutoChangeInfo.listPresets')
    expect(changeInfoSource).toContain('window.pageAutoChangeInfo.savePreset')
    expect(changeInfoSource).toContain('const canStart = !runtimeBusy && !runtimeActive && !isDirty')
    expect(changeInfoSource).toContain("runCommand('start')")
    expect(changeInfoSource).toContain('Bắt đầu')
  })

  it('keeps live Bio audit and exposes runtime pause/resume/stop plus typed result/log UI', () => {
    expect(changeInfoSource).toContain("item.key === 'bio'")
    expect(changeInfoSource).toContain("window.pageAutoChangeInfo.auditBio({ accountId: binding.accountId })")
    expect(changeInfoSource).toContain("enabledBindings.length !== 1")
    expect(changeInfoSource).toContain('Audit live')
    expect(changeInfoSource).toContain('Audit Tiểu sử')
    expect(changeInfoSource).toContain('JSON.stringify(bioAuditResult, null, 2)')
    expect(changeInfoSource).toContain("runCommand('pause')")
    expect(changeInfoSource).toContain("runCommand('resume')")
    expect(changeInfoSource).toContain("runCommand('stop')")
    expect(changeInfoSource).toContain('runtime.accounts.map')
    expect(changeInfoSource).toContain('runtime.logs.slice(-20)')
  })
})
