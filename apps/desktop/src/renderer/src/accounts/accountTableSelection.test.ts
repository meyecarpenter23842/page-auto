import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  clampContextMenuPoint,
  nextExcelDragRange,
  nextExcelRowRange,
  rowIdsBetween
} from './accountTableSelection'

const mainEntry = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
const accountManager = readFileSync(new URL('./AccountManager.tsx', import.meta.url), 'utf8')
const emailGrid = readFileSync(new URL('../hotmail/HotmailAuto.tsx', import.meta.url), 'utf8')
const sharedPicker = readFileSync(new URL('../actions/AccountBindingPickerModal.tsx', import.meta.url), 'utf8')
const selectionHelper = readFileSync(new URL('./accountTableSelection.ts', import.meta.url), 'utf8')
const menu = readFileSync(new URL('./AccountSelectionMenu.tsx', import.meta.url), 'utf8')

function sorted(set: ReadonlySet<number>): number[] {
  return [...set].sort((a, b) => a - b)
}

describe('Excel-style account table selection', () => {
  it('replaces a prior range on plain click and reserves toggling for Ctrl', () => {
    expect(rowIdsBetween([10, 20, 30, 40], 20, 40)).toEqual([20, 30, 40])

    const first = nextExcelRowRange([10, 20, 30, 40], new Set(), null, 20)
    expect(sorted(first.ids)).toEqual([20])
    expect(first.anchorId).toBe(20)

    const second = nextExcelRowRange([10, 20, 30, 40], first.ids, first.anchorId, 40)
    expect(sorted(second.ids)).toEqual([40])

    const sameAgain = nextExcelRowRange([10, 20, 30, 40], second.ids, second.anchorId, 40)
    expect(sorted(sameAgain.ids)).toEqual([40])

    const ctrlOff = nextExcelRowRange([10, 20, 30, 40], sameAgain.ids, sameAgain.anchorId, 40, { ctrlKey: true })
    expect(sorted(ctrlOff.ids)).toEqual([])
    const ctrlAdd = nextExcelRowRange([10, 20, 30, 40], new Set([20]), 20, 40, { ctrlKey: true })
    expect(sorted(ctrlAdd.ids)).toEqual([20, 40])
  })

  it('builds contiguous Shift and drag ranges without zebra selection', () => {
    const shift = nextExcelRowRange([10, 20, 30, 40], new Set([10, 40]), 20, 40, { shiftKey: true })
    expect(sorted(shift.ids)).toEqual([20, 30, 40])

    const dragged = nextExcelDragRange([10, 20, 30, 40], new Set(), 10, 30, 'add')
    expect(sorted(dragged)).toEqual([10, 20, 30])

    const ctrlDragged = nextExcelDragRange([10, 20, 30, 40], new Set([40]), 10, 30, 'add')
    expect(sorted(ctrlDragged)).toEqual([10, 20, 30, 40])

    const ctrlRemoved = nextExcelDragRange([10, 20, 30, 40], new Set([10, 20, 30, 40]), 20, 30, 'remove')
    expect(sorted(ctrlRemoved)).toEqual([10, 40])
  })

  it('tracks pointer drag locally and always releases it', () => {
    expect(selectionHelper).toContain('const onRowPointerEnter = (accountId: number) => {')
    expect(selectionHelper).toContain('nextExcelDragRange')
    expect(selectionHelper).toContain("window.addEventListener('pointerup', endDrag)")
    expect(selectionHelper).toContain("window.addEventListener('pointercancel', endDrag)")
  })

  it('places a measured context menu beside the pointer and flips at viewport edges', () => {
    expect(clampContextMenuPoint(400, 300, 230, 310, 1024, 768)).toEqual({ x: 404, y: 304 })
    expect(clampContextMenuPoint(980, 760, 230, 310, 1024, 768)).toEqual({ x: 746, y: 446 })
    expect(clampContextMenuPoint(1, 2, 230, 310, 1024, 768)).toEqual({ x: 8, y: 8 })
  })

  it('removes the renderer-wide paint-selection controller', () => {
    expect(mainEntry).not.toContain('installRecordRowPaintSelection')
    expect(mainEntry).not.toContain('recordRowPaintSelection.css')
    expect(mainEntry).toContain("import './accounts/accountTableSelection.css'")
  })

  it('keeps highlight range separate from real checked selection in primary account tables', () => {
    for (const source of [accountManager, emailGrid, sharedPicker]) {
      expect(source).toContain('range-row')
      expect(source).toContain('checked-row')
      expect(source).toContain('useExcelRowRange')
      expect(source).not.toContain('paintValue')
    }
    expect(emailGrid).not.toContain('lastSelectedId')
  })

  it('exposes right-click check commands for range, all rows, and clear-all', () => {
    expect(menu).toContain('Phần đang phủ khối')
    expect(menu).toContain('Chọn tất cả')
    expect(menu).toContain('Bỏ chọn tất cả')
    expect(menu).toContain('getBoundingClientRect')
    expect(menu).toContain('clampContextMenuPoint')
  })
})
