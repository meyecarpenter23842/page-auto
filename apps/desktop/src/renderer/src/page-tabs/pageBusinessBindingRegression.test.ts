import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const bindingScopeSource = readFileSync(new URL('./PageBusinessBindingScope.tsx', import.meta.url), 'utf8')
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
    expect(wallSource).toContain('disabled={scoped || busy || scheduling}')
    expect(actionSource).toContain('savedWorkspaces.filter((workspace) => !isPageBusinessWorkspace(workspace))')
  })
})
