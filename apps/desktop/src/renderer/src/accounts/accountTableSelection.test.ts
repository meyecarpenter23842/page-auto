import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  clampContextMenuPoint,
  nextExcelRowRange,
  rowIdsBetween
} from './accountTableSelection'

const mainEntry = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
const accountManager = readFileSync(new URL('./AccountManager.tsx', import.meta.url), 'utf8')
const emailGrid = readFileSync(new URL('../hotmail/HotmailAuto.tsx', import.meta.url), 'utf8')
const sharedPicker = readFileSync(new URL('../actions/AccountBindingPickerModal.tsx', import.meta.url), 'utf8')
const menu = readFileSync(new URL('./AccountSelectionMenu.tsx', import.meta.url), 'utf8')

function sorted(set: ReadonlySet<number>): number[] {
  return [...set].sort((a, b) => a - b)
}

describe('Excel-style account table selection', () => {
  it('builds contiguous ranges and preserves Ctrl additive selection', () => {
    expect(rowIdsBetween([10, 20, 30, 40], 20, 40)).toEqual([20, 30, 40])

    const first = nextExcelRowRange([10, 20, 30, 40], new Set(), null, 20)
    expect(sorted(first.ids)).toEqual([20])
    expect(first.anchorId).toBe(20)

    const ctrl = nextExcelRowRange([10, 20, 30, 40], first.ids, first.anchorId, 40, { ctrlKey: true })
    expect(sorted(ctrl.ids)).toEqual([20, 40])

    const shift = nextExcelRowRange([10, 20, 30, 40], ctrl.ids, ctrl.anchorId, 20, { shiftKey: true })
    expect(sorted(shift.ids)).toEqual([20, 30, 40])
  })

  it('clamps a measured context menu inside the current viewport', () => {
    expect(clampContextMenuPoint(980, 760, 230, 310, 1024, 768)).toEqual({ x: 786, y: 450 })
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
