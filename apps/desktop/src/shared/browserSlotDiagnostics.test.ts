import { describe, expect, it } from 'vitest'
import {
  browserSlotLayer,
  summarizeBrowserSlotCapacity,
  type BrowserSlotRuntimeAssignment
} from './browserSlotDiagnostics'

function assignment(accountId: number, slotIndex: number): BrowserSlotRuntimeAssignment {
  return { accountId, slotIndex, owners: ['profile'] }
}

describe('browser slot capacity diagnostics', () => {
  it('summarizes a full visible layer without overflow', () => {
    const assignments = Array.from({ length: 6 }, (_, index) => assignment(index + 1, index))
    expect(summarizeBrowserSlotCapacity(assignments, 6)).toEqual({
      capacity: 6,
      activeCount: 6,
      visibleCount: 6,
      freeVisibleSlots: 0,
      overflowCount: 0,
      nextFreeSlot: 6,
      layersUsed: 1
    })
  })

  it('reports holes and chooses the lowest free slot deterministically', () => {
    const summary = summarizeBrowserSlotCapacity([
      assignment(1, 0),
      assignment(2, 2),
      assignment(3, 5)
    ], 6)
    expect(summary.freeVisibleSlots).toBe(3)
    expect(summary.nextFreeSlot).toBe(1)
    expect(summary.overflowCount).toBe(0)
  })

  it('tracks overflow and layers for dozens of browsers', () => {
    const assignments = Array.from({ length: 36 }, (_, index) => assignment(index + 1, index))
    const summary = summarizeBrowserSlotCapacity(assignments, 6)
    expect(summary.activeCount).toBe(36)
    expect(summary.visibleCount).toBe(6)
    expect(summary.overflowCount).toBe(30)
    expect(summary.layersUsed).toBe(6)
    expect(browserSlotLayer(35, 6)).toBe(5)
  })

  it('does not count an overflow hole as a visible free slot', () => {
    const summary = summarizeBrowserSlotCapacity([
      assignment(1, 0),
      assignment(2, 1),
      assignment(3, 4),
      assignment(4, 8)
    ], 6)
    expect(summary.visibleCount).toBe(3)
    expect(summary.freeVisibleSlots).toBe(3)
    expect(summary.overflowCount).toBe(1)
    expect(summary.nextFreeSlot).toBe(2)
    expect(summary.layersUsed).toBe(2)
  })
})
