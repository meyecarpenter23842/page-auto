import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from './appSettings'
import {
  CHROME_MIN_COMPACT_OUTER_SIDE_PX,
  DEFAULT_BROWSER_WINDOW_LAYOUT,
  browserTileGrid,
  compactBrowserSlotAssignments,
  compactContentScale,
  computeBrowserWindowPlacement,
  effectiveSquareBrowserTileGrid,
  maximumTrueSquareRows,
  parseStoredBrowserWindowLayout,
  squareBrowserTileGrid,
  withSquareBrowserRows,
  type BrowserDisplayInfo
} from './browserWindowLayout'

const display: BrowserDisplayInfo = {
  id: 7,
  label: 'Test monitor',
  isPrimary: true,
  scaleFactor: 1,
  workArea: { x: 100, y: 40, width: 1920, height: 1040 }
}

const browser = { ...DEFAULT_APP_SETTINGS.browser, windowWidth: 1280, windowHeight: 800 }

describe('browser window layout', () => {
  it('keeps the legacy manual resolver available for old stored layouts', () => {
    expect(browserTileGrid({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, tileLayout: 'horizontal', tileCount: 4 }))
      .toEqual({ columns: 4, rows: 1, capacity: 4 })
    expect(browserTileGrid({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, tileLayout: 'vertical', tileCount: 5 }))
      .toEqual({ columns: 1, rows: 5, capacity: 5 })
  })

  it('stores the requested FPlus-style N by N rule from the selected vertical rows', () => {
    const two = withSquareBrowserRows({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }, 2)
    const three = withSquareBrowserRows(two, 3)
    const four = withSquareBrowserRows(three, 4)
    const five = withSquareBrowserRows(four, 5)

    expect(squareBrowserTileGrid(two)).toEqual({ columns: 2, rows: 2, capacity: 4 })
    expect(squareBrowserTileGrid(three)).toEqual({ columns: 3, rows: 3, capacity: 9 })
    expect(squareBrowserTileGrid(four)).toEqual({ columns: 4, rows: 4, capacity: 16 })
    expect(squareBrowserTileGrid(five)).toEqual({ columns: 5, rows: 5, capacity: 25 })
  })

  it('stores matching rows, columns and requested capacity after a user changes the row count', () => {
    expect(withSquareBrowserRows(DEFAULT_BROWSER_WINDOW_LAYOUT, 4)).toMatchObject({
      tileLayout: 'grid',
      rowCount: 4,
      gridColumns: 4,
      tileCount: 16,
      minimumCapacity: 16
    })
  })

  it('limits the real grid before Chrome can clamp a too-small square into a rectangle', () => {
    const layout = withSquareBrowserRows({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }, 4)

    expect(CHROME_MIN_COMPACT_OUTER_SIDE_PX).toBe(500)
    expect(maximumTrueSquareRows(display)).toBe(2)
    expect(effectiveSquareBrowserTileGrid(layout, display)).toEqual({ columns: 2, rows: 2, capacity: 4 })
  })

  it('places every real compact Chrome as a true square on a 1080p-class work area', () => {
    const layout = withSquareBrowserRows({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }, 4)
    const topLeft = computeBrowserWindowPlacement(layout, browser, display, 0)
    const second = computeBrowserWindowPlacement(layout, browser, display, 1)
    const secondRow = computeBrowserWindowPlacement(layout, browser, display, 2)
    const last = computeBrowserWindowPlacement(layout, browser, display, 3)

    expect(topLeft).toMatchObject({ width: 518, height: 518, x: 540, y: 40 })
    expect(second?.x).toBe((topLeft?.x ?? 0) + 522)
    expect(secondRow?.y).toBe((topLeft?.y ?? 0) + 522)
    expect(last?.width).toBe(last?.height)
    expect(last).not.toBeNull()
    expect(computeBrowserWindowPlacement(layout, browser, display, 4)).toBeNull()
  })

  it('does not reduce a requested grid when the display can fit Chrome minimum-width squares', () => {
    const largeDisplay: BrowserDisplayInfo = {
      ...display,
      workArea: { x: 0, y: 0, width: 3200, height: 2000 }
    }
    const layout = withSquareBrowserRows({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }, 3)

    expect(maximumTrueSquareRows(largeDisplay)).toBe(3)
    expect(effectiveSquareBrowserTileGrid(layout, largeDisplay)).toEqual({ columns: 3, rows: 3, capacity: 9 })
    const placement = computeBrowserWindowPlacement(layout, browser, largeDisplay, 8)
    expect(placement).not.toBeNull()
    expect(placement?.width).toBe(placement?.height)
    expect(placement?.width).toBeGreaterThanOrEqual(CHROME_MIN_COMPACT_OUTER_SIDE_PX)
  })

  it('scales page content down with the physical slot instead of keeping a huge cropped page', () => {
    expect(compactContentScale(browser, 1280, 800)).toBe(1)
    expect(compactContentScale(browser, 640, 400)).toBe(0.5)
    expect(compactContentScale(browser, 320, 200)).toBe(0.25)
  })

  it('keeps requested layouts up to 8 by 8 but clamps physical placement to the display limit', () => {
    const layout = withSquareBrowserRows({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }, 8)
    expect(squareBrowserTileGrid(layout)).toEqual({ columns: 8, rows: 8, capacity: 64 })
    expect(effectiveSquareBrowserTileGrid(layout, display)).toEqual({ columns: 2, rows: 2, capacity: 4 })
    expect(computeBrowserWindowPlacement(layout, browser, display, 3)).not.toBeNull()
    expect(computeBrowserWindowPlacement(layout, browser, display, 4)).toBeNull()
  })

  it('compacts sparse active slots before retiling so browsers fill holes', () => {
    expect(compactBrowserSlotAssignments([
      { accountId: 10, slotIndex: 0 },
      { accountId: 20, slotIndex: 2 },
      { accountId: 30, slotIndex: 3 }
    ])).toEqual([
      { accountId: 10, slotIndex: 0 },
      { accountId: 20, slotIndex: 1 },
      { accountId: 30, slotIndex: 2 }
    ])
  })

  it('migrates old layouts into the nearest square layout safely', () => {
    expect(parseStoredBrowserWindowLayout('{"enabled":true,"tileLayout":"grid","tileCount":12,"gridColumns":4}'))
      .toMatchObject({ rowCount: 3, gridColumns: 3, tileCount: 9, minimumCapacity: 9 })
    expect(parseStoredBrowserWindowLayout('{"enabled":true,"tileLayout":"horizontal","tileCount":4}'))
      .toMatchObject({ rowCount: 2, gridColumns: 2, tileCount: 4 })
    expect(parseStoredBrowserWindowLayout('{"tileCount":999}')).toEqual(DEFAULT_BROWSER_WINDOW_LAYOUT)
  })

  it('preserves capacity from the immediately previous horizontal/vertical schema even when rowCount was stored', () => {
    expect(parseStoredBrowserWindowLayout('{"enabled":true,"tileLayout":"horizontal","tileCount":4,"gridColumns":2,"rowCount":1,"minimumCapacity":4}'))
      .toMatchObject({ rowCount: 2, gridColumns: 2, tileCount: 4, minimumCapacity: 4 })
    expect(parseStoredBrowserWindowLayout('{"enabled":true,"tileLayout":"vertical","tileCount":5,"gridColumns":2,"rowCount":5,"minimumCapacity":5}'))
      .toMatchObject({ rowCount: 3, gridColumns: 3, tileCount: 9, minimumCapacity: 9 })
  })
})
