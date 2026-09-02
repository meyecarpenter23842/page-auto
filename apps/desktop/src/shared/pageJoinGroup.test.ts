import { describe, expect, it } from 'vitest'
import { cloneDefaultGroupWorkspaceDraft } from './groupWorkspaceConfig'
import {
  createDefaultPageJoinGroupWorkspaceConfig,
  parsePageJoinGroupWorkspaceConfig,
  serializePageJoinGroupWorkspaceConfig
} from './pageJoinGroup'

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
})
