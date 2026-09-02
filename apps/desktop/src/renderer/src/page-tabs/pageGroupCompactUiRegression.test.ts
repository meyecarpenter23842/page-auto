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
    expect(coreSource).toContain("activeBusiness === 'groups' ? <CompactGroupConfigControls />")
  })

  it('removes the old large config cards from the visible Nhóm layout', () => {
    expect(compactCssSource).toMatch(/\.page-business-group-pane \.pt-identity-panel,[\s\S]*\.pt-business-panel\s*\{\s*display:\s*none !important;/)
    expect(compactCssSource).toMatch(/\.page-business-group-pane \.pt-right-summary\s*\{\s*display:\s*none !important;/)
    expect(compactCssSource).toContain('.page-business-group-pane .pt-compact-config-launchers')
    expect(compactCssSource).toContain('.page-business-group-pane .pt-rotation-grid')
    expect(compactCssSource).toContain("width: 64px !important;")
  })

  it('does not regress Page selection back to synthetic DOM synchronization', () => {
    expect(bindingScopeSource).toContain('<PageTabsManager activePageId={activePageId} scoped />')
    expect(bindingScopeSource).not.toContain("querySelectorAll<HTMLButtonElement>('.page-tab-chip')")
    expect(bindingScopeSource).not.toContain("dispatchEvent(new Event('change'")
    expect(bindingScopeSource).not.toContain('setInterval(sync, 150)')
  })
})
