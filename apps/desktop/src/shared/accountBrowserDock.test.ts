import { describe, expect, it } from 'vitest'
import { computeAccountBrowserDockLayout } from './accountBrowserDock'

describe('computeAccountBrowserDockLayout', () => {
  it('returns no cells when there are no profile windows', () => {
    expect(computeAccountBrowserDockLayout(1000, [])).toEqual({
      cells: [],
      contentWidth: 1,
      contentHeight: 1
    })
  })

  it('keeps the original Chrome size instead of stretching to the manager', () => {
    const layout = computeAccountBrowserDockLayout(1200, [
      { width: 500, height: 350 },
      { width: 500, height: 350 }
    ], 4)

    expect(layout.cells).toEqual([
      { x: 4, y: 4, width: 500, height: 350 },
      { x: 508, y: 4, width: 500, height: 350 }
    ])
  })

  it('reflows fixed-size Chrome windows when the manager gets narrower', () => {
    const sizes = [
      { width: 500, height: 350 },
      { width: 500, height: 350 }
    ]
    const wide = computeAccountBrowserDockLayout(1200, sizes, 4)
    const narrow = computeAccountBrowserDockLayout(800, sizes, 4)

    expect(wide.cells[1]).toEqual({ x: 508, y: 4, width: 500, height: 350 })
    expect(narrow.cells[1]).toEqual({ x: 4, y: 358, width: 500, height: 350 })
  })

  it('grows the content area so many fixed-size profiles can be scrolled', () => {
    const layout = computeAccountBrowserDockLayout(
      1100,
      Array.from({ length: 5 }, () => ({ width: 500, height: 350 })),
      4
    )

    expect(layout.cells).toHaveLength(5)
    expect(layout.cells.every((cell) => cell.width === 500 && cell.height === 350)).toBe(true)
    expect(layout.contentHeight).toBe(1066)
  })

  it('allows horizontal overflow instead of shrinking an oversized Chrome window', () => {
    const layout = computeAccountBrowserDockLayout(700, [{ width: 900, height: 500 }], 4)
    expect(layout.cells[0]).toEqual({ x: 4, y: 4, width: 900, height: 500 })
    expect(layout.contentWidth).toBe(908)
  })
})
