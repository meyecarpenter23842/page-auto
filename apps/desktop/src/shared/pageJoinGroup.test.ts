import { describe, expect, it } from 'vitest'
import type { ActionWorkspaceRecord } from './actionWorkspaces'
import { cloneDefaultGroupWorkspaceDraft } from './groupWorkspaceConfig'
import { pageBusinessTypeOf } from './pageBusinessBindings'
import {
  createDefaultPageJoinGroupWorkspaceConfig,
  parsePageJoinGroupWorkspaceConfig,
  serializePageJoinGroupWorkspaceConfig
} from './pageJoinGroup'

function groupWorkspace(configJson: string): ActionWorkspaceRecord {
  return {
    id: 1,
    type: 'group',
    label: 'Tham gia nhóm',
    configJson,
    accounts: [],
    createdAt: 1,
    updatedAt: 1
  }
}

describe('Page Join Group workspace binding', () => {
  it('requires an explicit Page binding instead of treating every Page as selected', () => {
    expect(parsePageJoinGroupWorkspaceConfig('{}')).toBeNull()
    expect(parsePageJoinGroupWorkspaceConfig(JSON.stringify({ pageTabId: 0 }))).toBeNull()

    const parsed = parsePageJoinGroupWorkspaceConfig(createDefaultPageJoinGroupWorkspaceConfig(12))
    expect(parsed?.pageTabId).toBe(12)
    expect(parsed?.draft.sourceMode).toBe('id_distribute')
  })

  it('preserves the Page binding when business config is saved', () => {
    const draft = cloneDefaultGroupWorkspaceDraft()
    draft.keyword = 'thời trang'
    const parsed = parsePageJoinGroupWorkspaceConfig(serializePageJoinGroupWorkspaceConfig(9, draft))
    expect(parsed?.pageTabId).toBe(9)
    expect(parsed?.draft.keyword).toBe('thời trang')
  })

  it('does not classify a normal Hành động Group workspace just because config has pageTabId', () => {
    const normalGroupConfig = JSON.stringify({
      pageTabId: 123,
      sourceMode: 'id_shared',
      sourceTargets: '10001'
    })

    expect(parsePageJoinGroupWorkspaceConfig(normalGroupConfig)).toBeNull()
    expect(pageBusinessTypeOf(groupWorkspace(normalGroupConfig))).toBeNull()
  })

  it('recognizes the explicit join_group marker used by Page Tabs', () => {
    const configJson = createDefaultPageJoinGroupWorkspaceConfig(123)
    expect(pageBusinessTypeOf(groupWorkspace(configJson))).toBe('join_group')
  })
})
