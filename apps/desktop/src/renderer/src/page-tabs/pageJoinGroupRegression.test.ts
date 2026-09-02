import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const wrapper = readFileSync(new URL('./PageBusinessWorkspace.tsx', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('./PageJoinGroupWorkspace.tsx', import.meta.url), 'utf8')
const runner = readFileSync(new URL('../../../main/services/pageJoinGroupRunnerService.ts', import.meta.url), 'utf8')
const routing = readFileSync(new URL('../../../main/interactionWorkspaceRunnerIpc.ts', import.meta.url), 'utf8')

describe('Page Tham gia nhóm business binding', () => {
  it('adds the business tab without auto-rendering every canonical Page', () => {
    expect(wrapper).toContain('<strong>Tham gia nhóm</strong>')
    expect(wrapper).toContain('<PageJoinGroupWorkspace />')
    expect(workspace).toContain('+ Thêm Page')
    expect(workspace).toContain('parsePageJoinGroupWorkspaceConfig')
    expect(workspace).toContain('createActionWorkspace({')
    expect(workspace).toContain("type: 'group'")
    expect(workspace).not.toContain('createPageTab(')
  })

  it('unlinks only the business binding and keeps Page ownership in Quản lý Page', () => {
    expect(workspace).toContain('deleteActionWorkspace({ id: binding.workspace.id })')
    expect(workspace).not.toContain('deletePageTab(')
    expect(workspace).toContain('Page gốc không bị xóa')
  })

  it('uses canonical Page accounts and runs join_group as a Page actor', () => {
    expect(runner).toContain('const enabledPageAccounts = [...page.accounts]')
    expect(runner).not.toContain('const enabledBindings = [...workspace.accounts]')
    expect(runner).toContain("kind: 'page'")
    expect(runner).toContain('pageUid: active.frozen.pageUid')
    expect(runner).toContain("actionType: 'join_group'")
    expect(routing).toContain('parsePageJoinGroupWorkspaceConfig(workspace.configJson)')
    expect(routing).toContain('return pageJoinGroupService')
  })

  it('saves business config without writing a copied account list', () => {
    expect(workspace).toContain('patch: { configJson: nextConfig }')
    expect(workspace).toContain('account lấy trực tiếp từ Quản lý Page')
  })
})
