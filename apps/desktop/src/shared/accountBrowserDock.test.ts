import { describe, expect, it } from 'vitest'
import { computeAccountBrowserDockCells } from './accountBrowserDock'

describe('computeAccountBrowserDockCells', () => {
  it('returns no cells when there are no profile windows', () => {
    expect(computeAccountBrowserDockCells(1000, 700, 0)).toEqual([])
  })

  it('uses two columns for the common two-profile manager layout', () => {
    const cells = computeAccountBrowserDockCells(1000, 700, 2, 4)
    expect(cells).toHaveLength(2)
    expect(cells[0]?.y).toBe(4)
    expect(cells[1]?.x).toBeGreaterThan(cells[0]?.x ?? 0)
    expect(cells[0]?.width).toBe(cells[1]?.width)
  })

  it('keeps all cells inside the manager client area', () => {
    const width = 900
    const height = 600
    const cells = computeAccountBrowserDockCells(width, height, 5, 6)
    expect(cells).toHaveLength(5)
    for (const cell of cells) {
      expect(cell.x).toBeGreaterThanOrEqual(0)
      expect(cell.y).toBeGreaterThanOrEqual(0)
      expect(cell.x + cell.width).toBeLessThanOrEqual(width)
      expect(cell.y + cell.height).toBeLessThanOrEqual(height)
    }
  })
})
