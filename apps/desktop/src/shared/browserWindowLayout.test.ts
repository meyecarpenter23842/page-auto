import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from './appSettings'
import {
  DEFAULT_BROWSER_WINDOW_LAYOUT,
  MAX_COMPACT_GRID_SIDE,
  autoBalancedBrowserTileGrid,
  browserTileGrid,
  compactBrowserSlotAssignments,
  compactContentScale,
  computeBrowserWindowPlacement,
  parseStoredBrowserWindowLayout,
  squareBrowserTileGrid,
  withAutoBalancedBrowserRows,
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
  it('keeps legacy manual layouts readable for stored-config migration', () => {
    expect(browserTileGrid({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, tileLayout: 'horizontal', tileCount: 4 }))
      .toEqual({ columns: 4, rows: 1, capacity: 4 })
    expect(browserTileGrid({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, tileLayout: 'vertical', tileCount: 5 }))
      .toEqual({ columns: 1, rows: 5, capacity: 5 })
    expect(browserTileGrid({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, tileLayout: 'grid', tileCount: 12, gridColumns: 4 }))
      .toEqual({ columns: 4, rows: 3, capacity: 12 })
  })

  it('uses the selected vertical count as the horizontal count as well', () => {
    const two = withAutoBalancedBrowserRows({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }, 2)
    const three = withAutoBalancedBrowserRows(two, 3)
    const four = withAutoBalancedBrowserRows(three, 4)
    const five = withAutoBalancedBrowserRows(four, 5)
    const six = withAutoBalancedBrowserRows(five, 6)

    expect(squareBrowserTileGrid(two)).toEqual({ columns: 2, rows: 2, capacity: 4 })
    expect(squareBrowserTileGrid(three)).toEqual({ columns: 3, rows: 3, capacity: 9 })
    expect(squareBrowserTileGrid(four)).toEqual({ columns: 4, rows: 4, capacity: 16 })
    expect(squareBrowserTileGrid(five)).toEqual({ columns: 5, rows: 5, capacity: 25 })
    expect(squareBrowserTileGrid(six)).toEqual({ columns: 6, rows: 6, capacity: 36 })
  })

  it('does not change the square shape when monitor aspect ratio changes', () => {
    const layout = withAutoBalancedBrowserRows({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }, 4)
    const wide = autoBalancedBrowserTileGrid(layout, browser, display)
    const portrait = autoBalancedBrowserTileGrid(layout, browser, {
      ...display,
      workArea: { x: 0, y: 0, width: 1080, height: 1920 }
    })

    expect(wide).toEqual({ columns: 4, rows: 4, capacity: 16 })
    expect(portrait).toEqual(wide)
  })

  it('migrates old minimum capacity into the smallest safe square', () => {
    const migrated = parseStoredBrowserWindowLayout('{"enabled":true,"tileLayout":"horizontal","tileCount":4,"gridColumns":2}')
    expect(migrated).toMatchObject({ rowCount: 1, minimumCapacity: 4 })
    expect(squareBrowserTileGrid(migrated)).toEqual({ columns: 2, rows: 2, capacity: 4 })

    const legacy32 = parseStoredBrowserWindowLayout('{"enabled":true,"tileLayout":"horizontal","tileCount":32,"gridColumns":2}')
    expect(legacy32).toMatchObject({ rowCount: 1, minimumCapacity: 32 })
    expect(squareBrowserTileGrid(legacy32)).toEqual({ columns: 6, rows: 6, capacity: 36 })

    const userChanged = withAutoBalancedBrowserRows(migrated, 4)
    expect(userChanged.minimumCapacity).toBe(1)
    expect(squareBrowserTileGrid(userChanged)).toEqual({ columns: 4, rows: 4, capacity: 16 })
  })

  it('places Chrome in a real square grid and scales content in both axes', () => {
    const layout = withAutoBalancedBrowserRows({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }, 4)
    const grid = squareBrowserTileGrid(layout)
    const topLeft = computeBrowserWindowPlacement(layout, browser, display, 0)
    const secondRow = computeBrowserWindowPlacement(layout, browser, display, grid.columns)

    expect(grid).toEqual({ columns: 4, rows: 4, capacity: 16 })
    expect(topLeft?.width).toBeLessThan(display.workArea.width)
    expect(topLeft?.height).toBeLessThan(display.workArea.height)
    expect(secondRow?.y).toBeGreaterThan(topLeft?.y ?? 0)
    expect(topLeft?.contentScale).toBeLessThan(1)
  })

  it('scales the page content down with the physical slot instead of keeping a huge cropped page', () => {
    expect(compactContentScale(browser, 1280, 800)).toBe(1)
    expect(compactContentScale(browser, 640, 400)).toBe(0.5)
    expect(compactContentScale(browser, 320, 200)).toBe(0.25)
  })

  it('keeps the square side inside the explicit six-by-six ceiling', () => {
    const layout = withAutoBalancedBrowserRows({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }, 99)
    expect(MAX_COMPACT_GRID_SIDE).toBe(6)
    expect(layout.rowCount).toBe(6)
    expect(squareBrowserTileGrid(layout)).toEqual({ columns: 6, rows: 6, capacity: 36 })
    expect(computeBrowserWindowPlacement(layout, browser, display, 36)).toBeNull()
  })

  it('compacts sparse active slots before retiling so overflow browsers fill holes', () => {
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

  it('migrates old stored grid rows/capacity and safely falls back on invalid config', () => {
    const migrated = parseStoredBrowserWindowLayout('{"enabled":true,"tileLayout":"grid","tileCount":12,"gridColumns":4}')
    expect(migrated).toMatchObject({ rowCount: 3, minimumCapacity: 12 })
    expect(squareBrowserTileGrid(migrated)).toEqual({ columns: 4, rows: 4, capacity: 16 })
    expect(parseStoredBrowserWindowLayout('{"tileCount":999}')).toEqual(DEFAULT_BROWSER_WINDOW_LAYOUT)
  })
})
