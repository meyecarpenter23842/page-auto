import { describe, expect, it } from 'vitest'
import type { BrowserSlotRuntimeAssignment } from '../../../shared/browserSlotDiagnostics'
import {
  profileWorkspaceAssignments,
  resolveWorkspaceDisplay,
  workspaceHasBusinessBrowsers,
  type AccountWorkspaceDisplay
} from './accountBrowserWorkspaceModel'

const baseAssignments: BrowserSlotRuntimeAssignment[] = [
  { accountId: 1, slotIndex: 0, owners: ['profile'] },
  { accountId: 2, slotIndex: 1, owners: ['posting'] },
  { accountId: 3, slotIndex: 2, owners: ['profile', 'scenario'] }
]

function display(id: number, options: Partial<AccountWorkspaceDisplay> = {}): AccountWorkspaceDisplay {
  return {
    id,
    label: `Display ${id}`,
    isPrimary: false,
    isCursorDisplay: false,
    scaleFactor: 1,
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    slotRuntime: { capturedAt: 1, activeCount: baseAssignments.length, assignments: baseAssignments },
    ...options
  }
}

describe('accountBrowserWorkspaceModel', () => {
  it('shows only slots that are owned by Account profile windows', () => {
    expect(profileWorkspaceAssignments(baseAssignments).map((item) => item.accountId)).toEqual([1, 3])
  })

  it('blocks account-only retile when posting/scenario owns any active slot', () => {
    expect(workspaceHasBusinessBrowsers(baseAssignments)).toBe(true)
    expect(workspaceHasBusinessBrowsers([{ accountId: 1, slotIndex: 0, owners: ['profile'] }])).toBe(false)
  })

  it('prefers the saved display, then cursor display, then primary display', () => {
    const displays = [display(1, { isPrimary: true }), display(2, { isCursorDisplay: true }), display(3)]
    expect(resolveWorkspaceDisplay(displays, 3)?.id).toBe(3)
    expect(resolveWorkspaceDisplay(displays, null)?.id).toBe(2)
    expect(resolveWorkspaceDisplay([display(1, { isPrimary: true })], null)?.id).toBe(1)
  })
})
