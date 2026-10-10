import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  clampContextMenuPoint,
  edgeAutoScrollDelta,
  nextExcelDragRange,
  nextExcelRowRange,
  rowIdsBetween
} from './accountTableSelection'

const mainEntry = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
const accountManager = readFileSync(new URL('./AccountManager.tsx', import.meta.url), 'utf8')
const emailGrid = readFileSync(new URL('../hotmail/HotmailAuto.tsx', import.meta.url), 'utf8')
const proxyGrid = readFileSync(new URL('../proxy-builder/ProxyInventoryPanel.tsx', import.meta.url), 'utf8')
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

  it('preserves checked selection IDs with 3, 10 and 100 visible rows', () => {
    for (const size of [3, 10, 100]) {
      const ids = Array.from({ length: size }, (_, i) => i + 101)
      const click = nextExcelRowRange(ids, new Set<number>(), null, ids[0]!)
      const range = nextExcelRowRange(ids, click.ids, click.anchorId, ids[size - 1]!, { shiftKey: true })
      expect(sorted(range.ids)).toEqual(ids)
      const removed = nextExcelRowRange(ids, range.ids, range.anchorId, ids[1]!, { ctrlKey: true })
      expect(removed.ids.size).toBe(size - 1)
      expect(removed.ids.has(ids[1]!)).toBe(false)
      expect(nextExcelDragRange(ids, removed.ids, ids[1]!, ids[1]!, 'add').size).toBe(size)
    }
  })

  it('keeps large filtered ranges in visible order without selecting hidden target IDs', () => {
    const ids = Array.from({ length: 1000 }, (_, i) => i + 1).filter((id) => id % 2 === 0)
    const afterShift = nextExcelRowRange(ids, new Set([999]), 20, 200, { shiftKey: true })
    expect(afterShift.ids.size).toBe(91)
    expect([...afterShift.ids].every((id) => id % 2 === 0 && id >= 20 && id <= 200)).toBe(true)
    const afterCtrl = nextExcelRowRange(ids, afterShift.ids, afterShift.anchorId, 400, { ctrlKey: true })
    expect(afterCtrl.ids.has(400)).toBe(true)
    expect(afterCtrl.ids.has(999)).toBe(false)
  })

  it('auto-scrolls near the viewport edge but not beyond either end', () => {
    expect(edgeAutoScrollDelta(197, 0, 200, 0, 1000, 200)).toBeGreaterThan(0)
    expect(edgeAutoScrollDelta(1, 0, 200, 500, 1000, 200)).toBeLessThan(0)
    expect(edgeAutoScrollDelta(100, 0, 200, 300, 1000, 200)).toBe(0)
    expect(edgeAutoScrollDelta(199, 0, 200, 800, 1000, 200)).toBe(0)
    expect(edgeAutoScrollDelta(1, 0, 200, 0, 1000, 200)).toBe(0)
    expect(edgeAutoScrollDelta(199, 0, 200, 0, 100, 200)).toBe(0)
  })

  it('tracks pointer drag across table edges and always releases it', () => {
    expect(selectionHelper).toContain('const onRowPointerEnter = (accountId: number) => {')
    expect(selectionHelper).toContain('nextExcelDragRange')
    expect(selectionHelper).toContain("window.addEventListener('pointermove', onPointerMove)")
    expect(selectionHelper).toContain('window.requestAnimationFrame(frame)')
    expect(selectionHelper).toContain('host.scrollTop += dy')
    expect(selectionHelper).toContain('host.clientHeight - 5')
    expect(selectionHelper).toContain('host.clientWidth - 5')
    expect(selectionHelper).toContain("element?.closest<HTMLElement>('[data-excel-row-id]')")
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

  it('synchronizes pointer range and checked targets for all batch grids', () => {
    for (const source of [accountManager, emailGrid, proxyGrid, sharedPicker]) {
      expect(source).toContain('range-row')
      expect(source).toContain('checked-row')
      expect(source).toContain('useExcelRowRange')
      expect(source).toContain('data-excel-row-id=')
      expect(source).toMatch(/useExcelRowRange\([^\n]*, (?:selectedIds|selection|selected), set(?:SelectedIds|Selection|Selected)\)/)
      expect(source).not.toContain('paintValue')
    }
    expect(emailGrid).not.toContain('lastSelectedId')
    expect(selectionHelper).toContain('checkedChangeRef.current?.(new Set(next.ids))')
    expect(selectionHelper).toContain('if (checkedIds?.has(accountId)) return')
  })

  it('uses the canonical checked list for proxy context actions', () => {
    expect(proxyGrid).toContain("markUsage([...selected], true, 'đang chọn')")
    expect(proxyGrid).toContain("copyInventory([...selected], 'đang chọn')")
    expect(proxyGrid).not.toContain("'phần phủ khối'")
  })

  it('exposes right-click check commands for range, all rows, and clear-all', () => {
    expect(menu).toContain('Phần đang phủ khối')
    expect(menu).toContain('Chọn tất cả')
    expect(menu).toContain('Bỏ chọn tất cả')
    expect(menu).toContain('getBoundingClientRect')
    expect(menu).toContain('clampContextMenuPoint')
  })
})
