export type BrowserSlotRuntimeOwner = 'profile' | 'posting'

export interface BrowserSlotRuntimeAssignment {
  accountId: number
  slotIndex: number
  owners: BrowserSlotRuntimeOwner[]
}

export interface BrowserSlotRuntimeSnapshot {
  capturedAt: number
  activeCount: number
  assignments: BrowserSlotRuntimeAssignment[]
}

export interface BrowserDisplaySlotRuntimeExtension {
  isCursorDisplay: boolean
  slotRuntime: BrowserSlotRuntimeSnapshot
}

export interface BrowserSlotCapacitySummary {
  capacity: number
  activeCount: number
  visibleCount: number
  freeVisibleSlots: number
  overflowCount: number
  nextFreeSlot: number
  layersUsed: number
}

export function summarizeBrowserSlotCapacity(
  assignments: readonly BrowserSlotRuntimeAssignment[],
  capacity: number
): BrowserSlotCapacitySummary {
  const safeCapacity = Math.max(1, Math.floor(Number.isFinite(capacity) ? capacity : 1))
  const used = new Set<number>()
  let maxSlot = -1
  let visibleCount = 0

  for (const assignment of assignments) {
    const slotIndex = Math.max(0, Math.floor(assignment.slotIndex))
    used.add(slotIndex)
    if (slotIndex < safeCapacity) visibleCount += 1
    if (slotIndex > maxSlot) maxSlot = slotIndex
  }

  let nextFreeSlot = 0
  while (used.has(nextFreeSlot)) nextFreeSlot += 1

  const activeCount = assignments.length
  const overflowCount = Math.max(0, activeCount - visibleCount)
  return {
    capacity: safeCapacity,
    activeCount,
    visibleCount,
    freeVisibleSlots: Math.max(0, safeCapacity - visibleCount),
    overflowCount,
    nextFreeSlot,
    layersUsed: maxSlot < 0 ? 0 : Math.floor(maxSlot / safeCapacity) + 1
  }
}

export function browserSlotLayer(slotIndex: number, capacity: number): number {
  const safeCapacity = Math.max(1, Math.floor(Number.isFinite(capacity) ? capacity : 1))
  return Math.floor(Math.max(0, Math.floor(slotIndex)) / safeCapacity)
}
