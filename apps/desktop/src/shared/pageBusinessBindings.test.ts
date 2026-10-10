import { describe, expect, it } from 'vitest'
import type { ActionWorkspaceRecord } from './actionWorkspaces'
import {
  isPageBusinessWorkspace,
  pageBusinessPageIdOf,
  pageBusinessTypeOf,
  serializePageBusinessBindingConfig
} from './pageBusinessBindings'
import { createDefaultPageJoinGroupWorkspaceConfig } from './pageJoinGroup'

function workspace(overrides: Partial<ActionWorkspaceRecord>): ActionWorkspaceRecord {
  return {
    id: 1,
    type: 'interaction',
    label: 'Workspace',
    configJson: '{}',
    accounts: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('Page business workspace ownership', () => {
  it('recognizes explicit Page-bound Tham gia nhóm records', () => {
    const record = workspace({
      type: 'group',
      label: 'Thông Chi · Tham gia nhóm',
      configJson: createDefaultPageJoinGroupWorkspaceConfig(17)
    })

    expect(pageBusinessTypeOf(record)).toBe('join_group')
    expect(pageBusinessPageIdOf(record)).toBe(17)
    expect(isPageBusinessWorkspace(record)).toBe(true)
  })

  it('keeps normal Action workspaces outside Page business ownership even if config has pageTabId', () => {
    const normalGroup = workspace({
      type: 'group',
      label: 'Tham gia nhóm',
      configJson: JSON.stringify({ pageTabId: 17, sourceMode: 'id_shared' })
    })
    const normalInteraction = workspace({
      type: 'interaction',
      label: 'Tương tác',
      configJson: JSON.stringify({ targetMode: 'friends' })
    })

    expect(isPageBusinessWorkspace(normalGroup)).toBe(false)
    expect(isPageBusinessWorkspace(normalInteraction)).toBe(false)
  })

  it('keeps each Page business binding type independent', () => {
    const types = ['group_post', 'page_wall_post', 'page_edit', 'run_scenario'] as const
    const records = types.map((type, index) => workspace({
      id: index + 1,
      configJson: serializePageBusinessBindingConfig(type, index + 10)
    }))

    expect(records.map(pageBusinessTypeOf)).toEqual(types)
    expect(records.map(pageBusinessPageIdOf)).toEqual([10, 11, 12, 13])
  })
})
