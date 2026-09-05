import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const bindingScopeSource = readFileSync(new URL('./PageBusinessBindingScope.tsx', import.meta.url), 'utf8')
const bindingCssSource = readFileSync(new URL('./pageBusinessBindings.css', import.meta.url), 'utf8')
const groupManagerSource = readFileSync(new URL('./PageTabsManagerV2.tsx', import.meta.url), 'utf8')
const wallSource = readFileSync(new URL('./PageWallWorkspace.tsx', import.meta.url), 'utf8')
const coreSource = readFileSync(new URL('./PageBusinessWorkspaceCore.tsx', import.meta.url), 'utf8')
const actionSource = readFileSync(new URL('../actions/ActionWorkspace.tsx', import.meta.url), 'utf8')

describe('Page business binding regression', () => {
  it('does not synchronize the active Page through hidden DOM clicks or synthetic change events', () => {
    expect(bindingScopeSource).not.toContain("querySelectorAll<HTMLButtonElement>('.page-tab-chip')")
    expect(bindingScopeSource).not.toContain("dispatchEvent(new Event('change'")
    expect(bindingScopeSource).not.toContain('setInterval(sync, 150)')
    expect(bindingScopeSource).toContain('<PageTabsManager activePageId={activePageId} scoped />')
    expect(bindingScopeSource).toContain('<PageWallWorkspace activePageId={activePageId} scoped />')
  })

  it('keeps the scoped Page business child on a definite-height layout chain', () => {
    expect(bindingScopeSource).toContain('className="page-business-binding-content"')
    expect(bindingCssSource).toMatch(/\.page-business-binding-scope\s*\{[^}]*height:\s*100%;[^}]*display:\s*flex;/s)
    const contentRule = bindingCssSource.match(/\.page-business-binding-content\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(contentRule).toContain('min-height: 0;')
    expect(contentRule).toContain('flex: 1 1 0;')
    expect(bindingCssSource).toMatch(/\.page-business-scoped-child[\s\S]*height:\s*100%;/)
    expect(bindingCssSource).toContain('.page-business-scoped-child > .page-tabs-manager')
  })

  it('drives Đăng Nhóm config and runtime from the bound Page id', () => {
    expect(groupManagerSource).toContain('activePageId: controlledActiveId')
    expect(groupManagerSource).toContain('const nextActive = controlledActiveId ?? preferredId ?? activeId')
    expect(groupManagerSource).toContain('!scoped ? <div className="page-tabs-strip"')
    expect(coreSource).toContain('CurrentPageRuntimeActions({ activePageId }')
    expect(coreSource).toContain("action({ pageTabId: activePageId })")
    expect(coreSource).not.toContain("findIndex((button) => button.classList.contains('active'))")
  })

  it('drives Đăng Tường from the bound Page id and keeps Hành động Page-free', () => {
    expect(wallSource).toContain('activePageId: controlledPageId')
    expect(wallSource).toContain('disabled={scoped || operationBusy}')
    expect(actionSource).toContain('savedWorkspaces.filter((workspace) => !isPageBusinessWorkspace(workspace))')
  })
})
