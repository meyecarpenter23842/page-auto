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

  it('renders catalog, Data Source and presets while keeping Facebook Start locked before live audit', () => {
    expect(changeInfoSource).toContain('Chọn thay đổi')
    expect(changeInfoSource).toContain('Nguồn dữ liệu')
    expect(changeInfoSource).toContain('Phân bổ snapshot')
    expect(changeInfoSource).toContain('window.pageAutoChangeInfo.listPresets')
    expect(changeInfoSource).toContain('window.pageAutoChangeInfo.savePreset')
    expect(changeInfoSource).toContain('Live audit required')
    expect(changeInfoSource).toContain('<button type="button" disabled>Bắt đầu</button>')
  })
})
