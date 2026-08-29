import type { BrowserDisplayInfo } from '../../../shared/browserWindowLayout'
import type {
  BrowserDisplaySlotRuntimeExtension,
  BrowserSlotRuntimeAssignment
} from '../../../shared/browserSlotDiagnostics'

export type AccountWorkspaceDisplay = BrowserDisplayInfo & BrowserDisplaySlotRuntimeExtension

export function workspaceAssignments(displays: readonly AccountWorkspaceDisplay[]): BrowserSlotRuntimeAssignment[] {
  return displays[0]?.slotRuntime.assignments ?? []
}

export function profileWorkspaceAssignments(
  assignments: readonly BrowserSlotRuntimeAssignment[]
): BrowserSlotRuntimeAssignment[] {
  return assignments.filter((assignment) => assignment.owners.includes('profile'))
}

export function workspaceHasBusinessBrowsers(
  assignments: readonly BrowserSlotRuntimeAssignment[]
): boolean {
  return assignments.some((assignment) => assignment.owners.some((owner) => owner !== 'profile'))
}

export function resolveWorkspaceDisplay(
  displays: readonly AccountWorkspaceDisplay[],
  targetDisplayId: number | null
): AccountWorkspaceDisplay | null {
  if (targetDisplayId !== null) {
    const selected = displays.find((display) => display.id === targetDisplayId)
    if (selected) return selected
  }
  return displays.find((display) => display.isCursorDisplay)
    ?? displays.find((display) => display.isPrimary)
    ?? displays[0]
    ?? null
}
