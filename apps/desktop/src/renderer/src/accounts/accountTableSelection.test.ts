import { describe, expect, it } from 'vitest'
import {
  nextExcelRowRange,
  selectContiguousAccountRange,
  type AccountTableSelectionState
} from './accountTableSelection'

describe('accountTableSelection', () => {
  it('selects a contiguous range in either direction', () => {
    expect([...selectContiguousAccountRange([1, 2, 3, 4], 2, 4)]).toEqual([2, 3, 4])
    expect([...selectContiguousAccountRange([1, 2, 3, 4], 4, 2)]).toEqual([2, 3, 4])
  })

  it('toggles rows without Ctrl and adds shift ranges', () => {
    const empty: AccountTableSelectionState = {
      rangeIds: new Set(),
      anchorId: null,
      focusId: null
    }

    const first = nextExcelRowRange(empty, [1, 2, 3, 4], 2, {})
    expect([...first.rangeIds]).toEqual([2])
    expect(first.anchorId).toBe(2)

    const second = nextExcelRowRange(first, [1, 2, 3, 4], 4, {})
    expect([...second.rangeIds]).toEqual([2, 4])

    const toggledOff = nextExcelRowRange(second, [1, 2, 3, 4], 2, {})
    expect([...toggledOff.rangeIds]).toEqual([4])

    const ctrlToggled = nextExcelRowRange(toggledOff, [1, 2, 3, 4], 3, { ctrlKey: true })
    expect([...ctrlToggled.rangeIds]).toEqual([4, 3])

    const metaToggled = nextExcelRowRange(ctrlToggled, [1, 2, 3, 4], 4, { metaKey: true })
    expect([...metaToggled.rangeIds]).toEqual([3])

    const withPriorSelection: AccountTableSelectionState = {
      rangeIds: new Set([1, 3]),
      anchorId: 3,
      focusId: 3
    }
    const shifted = nextExcelRowRange(withPriorSelection, [1, 2, 3, 4], 4, { shiftKey: true })
    expect([...shifted.rangeIds]).toEqual([1, 3, 4])
    expect(shifted.anchorId).toBe(3)
  })
})
