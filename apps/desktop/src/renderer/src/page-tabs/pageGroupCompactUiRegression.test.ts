import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const coreSource = readFileSync(new URL('./PageBusinessWorkspaceCore.tsx', import.meta.url), 'utf8')
const compactCssSource = readFileSync(new URL('./issue98CompactGroup.css', import.meta.url), 'utf8')
const bindingScopeSource = readFileSync(new URL('./PageBusinessBindingScope.tsx', import.meta.url), 'utf8')

describe('Page Nhóm compact UI regression', () => {
  it('keeps the approved issue #98 compact configuration launchers', () => {
    expect(coreSource).toContain("import './issue98CompactGroup.css'")
    expect(coreSource).toContain('aria-label="Cấu hình nhanh Đăng Nhóm"')
    expect(coreSource).toContain('<span>Nhận diện</span>')
    expect(coreSource).toContain('<span>Lịch chạy</span>')
    expect(coreSource).toContain('<span>Group</span>')
    expect(coreSource).toContain('<span>Bài viết</span>')
    expect(coreSource).toContain("activeBusiness === 'groups' ? <CompactGroupConfigControls editorActions={groupEditorActions} />")
    expect(coreSource).not.toContain('openExistingEditor =')
    expect(coreSource).toContain('editorActions?.schedule()')
    expect(coreSource).toContain('editorActions?.groups()')
    expect(coreSource).toContain('editorActions?.posts()')
  })

  it('keeps identity as modal while showing operational configuration in the right pane', () => {
    expect(compactCssSource).toMatch(/\.page-business-group-pane \.pt-identity-panel\s*\{\s*display:\s*none !important;/)
    expect(compactCssSource).toMatch(/\.page-business-group-pane \.pt-business-panel\s*\{\s*display:\s*block !important;/)
    expect(compactCssSource).toMatch(/\.page-business-group-pane \.pt-right-summary\s*\{\s*display:\s*none !important;/)
    expect(compactCssSource).toContain('.page-business-group-pane .pt-compact-config-launchers')
    expect(compactCssSource).toContain('position: static;')
    expect(compactCssSource).toContain('grid-row: 2;')
    expect(coreSource).toContain("root.querySelector<HTMLElement>('.page-tab-right-pane')")
    expect(compactCssSource).toContain('.page-business-group-pane .pt-rotation-grid')
    expect(compactCssSource).toContain("width: 64px !important;")
  })

  it('does not regress Page selection back to synthetic DOM synchronization', () => {
    expect(bindingScopeSource).toContain('<PageTabsManager activePageId={activePageId} scoped registerEditorActions={registerEditorActions} />')
    expect(bindingScopeSource).not.toContain("querySelectorAll<HTMLButtonElement>('.page-tab-chip')")
    expect(bindingScopeSource).not.toContain("dispatchEvent(new Event('change'")
    expect(bindingScopeSource).not.toContain('setInterval(sync, 150)')
  })
})
