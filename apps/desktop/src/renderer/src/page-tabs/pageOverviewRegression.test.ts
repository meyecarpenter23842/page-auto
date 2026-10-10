import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const core = readFileSync(new URL('./PageBusinessWorkspaceCore.tsx', import.meta.url), 'utf8')
const scope = readFileSync(new URL('./PageBusinessBindingScope.tsx', import.meta.url), 'utf8')
const overview = readFileSync(new URL('./PageOverviewWorkspace.tsx', import.meta.url), 'utf8')
const manager = readFileSync(new URL('./PageTabsManagerV2.tsx', import.meta.url), 'utf8')
describe('Issue #510 Page Tabs UI regressions', () => {
  it('uses Main-owned status and persisted schedules and keeps existing group controls', () => {
    expect(core).toContain('<PageOverviewWorkspace onOpenGroup={openGroupPage} />')
    expect(core).toContain('<CurrentPageRuntimeActions activePageId={activePage.id} />')
    expect(overview).toContain('window.pageAuto.listPageTabRotations()')
    expect(overview).toContain('window.pageAuto.getPageTab({ id: page.id })')
  })
  it('targets an existing bound Page and does not create one on navigation', () => {
    expect(core).toContain('preferredPageId={selectedPageId}')
    expect(scope).toContain('binding.pageTabId === preferredPageId')
    expect(scope).toContain('selected?.workspace.id ?? null')
  })
  it('registers launchers without DOM click and retains dirty/save contracts', () => {
    expect(manager).toContain('registerEditorActions?.({')
    expect(manager).toContain("schedule: () => setEditorModal('schedule')")
    expect(manager).toContain('useUnsavedWorkspaceChanges(dirtySections.size > 0')
    expect(manager).toContain('window.pageAuto.updatePageTab')
    expect(manager).toContain('sortScheduleEditorRows(config?.schedules ?? [])')
    expect(core).not.toContain("querySelectorAll<HTMLElement>('.page-business-group-pane .pt-business-row')")
  })
  it('clearly marks Page Edit as unsupported', () => {
    expect(core).toContain("status: 'Chưa hỗ trợ'")
    expect(core).toContain('<BoundPlaceholder business={active} />')
  })
})
