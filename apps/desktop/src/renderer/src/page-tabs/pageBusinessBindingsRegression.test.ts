import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const core = readFileSync(new URL('./PageBusinessWorkspaceCore.tsx', import.meta.url), 'utf8')
const wrapper = readFileSync(new URL('./PageBusinessWorkspace.tsx', import.meta.url), 'utf8')
const scope = readFileSync(new URL('./PageBusinessBindingScope.tsx', import.meta.url), 'utf8')
const join = readFileSync(new URL('./PageJoinGroupWorkspace.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./pageBusinessBindings.css', import.meta.url), 'utf8')
const actions = readFileSync(new URL('../actions/ActionWorkspace.tsx', import.meta.url), 'utf8')

describe('Page business explicit Page bindings', () => {
  it('keeps all five Page businesses inside Page Tabs', () => {
    expect(core).toContain("label: 'Nhóm'")
    expect(core).toContain("label: 'Đăng Tường'")
    expect(core).toContain("label: 'Sửa Page'")
    expect(core).toContain("label: 'Tham gia nhóm'")
    expect(core).toContain("label: 'Chạy kịch bản'")
    expect(wrapper).not.toContain('PageJoinGroupTabBridge')
  })

  it('keeps a separate explicit Page binding per Page business', () => {
    expect(core).toContain('businessType="group_post"')
    expect(core).toContain('businessType="page_wall_post"')
    expect(core).toContain("bindingType: 'page_edit'")
    expect(core).toContain('<PageJoinGroupWorkspace />')
    expect(core).toContain("bindingType: 'run_scenario'")
    expect(scope).toContain('+ Thêm Page')
    expect(join).toContain('+ Thêm Page')
  })

  it('requires explicit add/unlink without deleting the canonical Page', () => {
    expect(scope).toContain('Page trong Quản lý Page không tự xuất hiện ở đây.')
    expect(scope).toContain('deleteActionWorkspace({ id: binding.workspace.id })')
    expect(scope).not.toContain('deletePageTab(')
    expect(join).not.toContain('deletePageTab(')
  })

  it('keeps Page business bindings out of the general Hành động tabs', () => {
    expect(actions).toContain('isPageBusinessWorkspace')
    expect(actions).toContain('filter((workspace) => !isPageBusinessWorkspace(workspace))')
  })

  it('never hides the embedded Nhóm workspace while Page selection is synchronizing', () => {
    expect(styles).toContain('.page-business-scoped-child,')
    expect(styles).toContain('.page-business-scoped-child.ready')
    expect(styles).toContain('opacity: 1')
    expect(styles).not.toContain('.page-business-scoped-child { opacity: 0')
  })
})
