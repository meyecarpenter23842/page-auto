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

  it('keeps Kịch bản as the fixed default tab and turns + Tab into a workspace picker', () => {
    expect(workspaceSource).toContain('<ScenarioWorkspace />')
    expect(workspaceSource).toContain('Kịch bản')
    expect(workspaceSource).toContain('+ Tab')
    expect(workspaceSource).toContain('Chọn tab nghiệp vụ')
    expect(workspaceSource).toContain('<InteractionWorkspace instanceLabel={tab.label} />')
    expect(registrySource).toContain("id: 'interaction'")
    expect(registrySource).toContain("label: 'Tương tác'")
  })

  it('makes Tương tác a checkbox composition workspace instead of another atomic action picker', () => {
    expect(interactionSource).toContain('Đối tượng tương tác')
    expect(interactionModelSource).toContain("label: 'Like / Reaction'")
    expect(interactionModelSource).toContain("label: 'Reply comment'")
    expect(interactionModelSource).toContain("label: 'Tag trong comment'")
    expect(interactionSource).toContain('Kế hoạch module')
    expect(interactionSource).toContain('Runner chưa nối')
  })
})
