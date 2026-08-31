import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const workspaceSource = readFileSync(new URL('./ActionWorkspace.tsx', import.meta.url), 'utf8')

describe('Action workspace shell', () => {
  it('uses Hành động as the semantic main route', () => {
    expect(appSource).toContain("{ id: 'actions', label: 'Hành động' }")
    expect(appSource).not.toContain("{ id: 'scenarios', label: 'Kịch Bản' }")
    expect(appSource).toContain("activeRoute === 'actions' ? 'HÀNH ĐỘNG'")
    expect(appSource).toContain("activeRoute === 'actions' ? <ActionWorkspace />")
  })

  it('keeps Kịch bản as the default child and leaves + Tab as an extension point', () => {
    expect(workspaceSource).toContain('<ScenarioWorkspace />')
    expect(workspaceSource).toContain('Kịch bản')
    expect(workspaceSource).toContain('+ Tab')
    expect(workspaceSource).toContain('Chọn loại hành động sẽ được bổ sung ở lô sau.')
  })
})
