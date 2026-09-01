import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const workspaceSource = readFileSync(new URL('./ActionWorkspace.tsx', import.meta.url), 'utf8')
const registrySource = readFileSync(new URL('./actionWorkspaceRegistry.ts', import.meta.url), 'utf8')
const interactionSource = readFileSync(new URL('./InteractionWorkspace.tsx', import.meta.url), 'utf8')
const interactionModelSource = readFileSync(new URL('./interactionWorkspaceModel.ts', import.meta.url), 'utf8')

describe('Action workspace shell', () => {
  it('uses Hành động as the semantic main route', () => {
    expect(appSource).toContain("{ id: 'actions', label: 'Hành động' }")
    expect(appSource).not.toContain("{ id: 'scenarios', label: 'Kịch Bản' }")
    expect(appSource).toContain("activeRoute === 'actions' ? 'HÀNH ĐỘNG'")
    expect(appSource).toContain("activeRoute === 'actions' ? <ActionWorkspace />")
  })

  it('keeps Kịch bản fixed and persists dynamic workspace tabs through typed preload APIs', () => {
    expect(workspaceSource).toContain('<ScenarioWorkspace />')
    expect(workspaceSource).toContain('Kịch bản')
    expect(workspaceSource).toContain('+ Tab')
    expect(workspaceSource).toContain('Chọn tab nghiệp vụ')
    expect(workspaceSource).toContain('window.pageAuto.listActionWorkspaces()')
    expect(workspaceSource).toContain('window.pageAuto.createActionWorkspace')
    expect(workspaceSource).toContain('window.pageAuto.deleteActionWorkspace')
    expect(workspaceSource).toContain('<InteractionWorkspace workspace={tab} availableAccounts={accounts}')
    expect(registrySource).toContain("id: 'interaction'")
    expect(registrySource).toContain("label: 'Tương tác'")
  })

  it('binds Account Manager rows, persists composition and exposes runner controls', () => {
    expect(interactionSource).toContain('Tài khoản chạy')
    expect(interactionSource).toContain('availableAccounts')
    expect(interactionSource).toContain('Thứ tự chạy')
    expect(interactionSource).toContain('window.pageAuto.updateActionWorkspace')
    expect(interactionSource).toContain('Lưu cấu hình')
    expect(interactionModelSource).toContain("label: 'Like / Reaction'")
    expect(interactionModelSource).toContain("label: 'Reply comment'")
    expect(interactionModelSource).toContain("label: 'Tag trong comment'")
    expect(interactionSource).toContain('Kế hoạch module')
    expect(interactionSource).toContain("runCommand('start')")
    expect(interactionSource).toContain("runCommand('pause')")
    expect(interactionSource).toContain("runCommand('resume')")
    expect(interactionSource).toContain("runCommand('stop')")
    expect(interactionSource).not.toContain('Runner chưa nối')
  })
})
