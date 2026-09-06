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

  it('renders a dense desktop operation form with accounts, inline Data Source and presets while Facebook Start stays locked', () => {
    expect(changeInfoSource).toContain('Tài khoản chạy')
    expect(changeInfoSource).toContain('change-info-groups')
    expect(changeInfoSource).toContain('change-info-inline-editor')
    expect(changeInfoSource).toContain('aria-label={`Nguồn ${catalog.label}`}')
    expect(changeInfoSource).toContain('window.pageAutoChangeInfo.listPresets')
    expect(changeInfoSource).toContain('window.pageAutoChangeInfo.savePreset')
    expect(changeInfoSource).toContain('Chế độ cấu hình · chưa chạy thay đổi trên Facebook')
    expect(changeInfoSource).toContain('className="change-info-start" disabled>Bắt đầu</button>')
    expect(changeInfoSource).not.toContain('Live audit required')
    expect(changeInfoSource).not.toContain('ACCOUNT / PROFILE COMPOSER')
  })

  it('exposes a single-account read-only Bio audit entry without unlocking mutation Start', () => {
    expect(changeInfoSource).toContain("item.key === 'bio'")
    expect(changeInfoSource).toContain("window.pageAutoChangeInfo.auditBio({ accountId: binding.accountId })")
    expect(changeInfoSource).toContain("enabledBindings.length !== 1")
    expect(changeInfoSource).toContain('Audit live')
    expect(changeInfoSource).toContain('Audit Tiểu sử')
    expect(changeInfoSource).toContain('JSON.stringify(bioAuditResult, null, 2)')
    expect(changeInfoSource).toContain('className="change-info-start" disabled>Bắt đầu</button>')
  })
})
