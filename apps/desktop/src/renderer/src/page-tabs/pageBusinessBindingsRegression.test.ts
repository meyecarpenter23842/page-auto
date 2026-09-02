import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const core = readFileSync(new URL('./PageBusinessWorkspaceCore.tsx', import.meta.url), 'utf8')
const wrapper = readFileSync(new URL('./PageBusinessWorkspace.tsx', import.meta.url), 'utf8')
const scope = readFileSync(new URL('./PageBusinessBindingScope.tsx', import.meta.url), 'utf8')
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

  it('requires explicit add/unlink for Page business tabs', () => {
    expect(scope).toContain('+ Thêm Page')
    expect(scope).toContain('Page trong Quản lý Page không tự xuất hiện ở đây.')
    expect(scope).toContain('deleteActionWorkspace({ id: binding.workspace.id })')
    expect(scope).not.toContain('deletePageTab(')
  })

  it('keeps Page business bindings out of the general Hành động tabs', () => {
    expect(actions).toContain('isPageBusinessWorkspace')
    expect(actions).toContain('filter((workspace) => !isPageBusinessWorkspace(workspace))')
  })
})
