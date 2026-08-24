import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from './appSettings'
import {
  DEFAULT_BROWSER_WINDOW_LAYOUT,
  autoBalancedBrowserTileGrid,
  browserTileGrid,
  compactBrowserSlotAssignments,
  compactContentScale,
  computeBrowserWindowPlacement,
  parseStoredBrowserWindowLayout,
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

  it('derives horizontal columns automatically from only the selected vertical rows', () => {
    const twoRows = withAutoBalancedBrowserRows({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }, 2)
    const threeRows = withAutoBalancedBrowserRows(twoRows, 3)
    const fourRows = withAutoBalancedBrowserRows(threeRows, 4)

    expect(autoBalancedBrowserTileGrid(twoRows, browser, display)).toEqual({ columns: 3, rows: 2, capacity: 6 })
    expect(autoBalancedBrowserTileGrid(threeRows, browser, display)).toEqual({ columns: 4, rows: 3, capacity: 12 })
    expect(autoBalancedBrowserTileGrid(fourRows, browser, display)).toEqual({ columns: 5, rows: 4, capacity: 20 })
  })

  it('recomputes balance from the target monitor aspect ratio instead of saving user-calculated columns', () => {
    const layout = withAutoBalancedBrowserRows({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }, 3)
    const wide = autoBalancedBrowserTileGrid(layout, browser, display)
    const portrait = autoBalancedBrowserTileGrid(layout, browser, {
      ...display,
      workArea: { x: 0, y: 0, width: 1080, height: 1920 }
    })

    expect(wide).toEqual({ columns: 4, rows: 3, capacity: 12 })
    expect(portrait.columns).toBeLessThan(wide.columns)
    expect(portrait.rows).toBe(3)
  })

  it('preserves the old horizontal capacity until the user explicitly chooses a new row count', () => {
    const migrated = parseStoredBrowserWindowLayout('{"enabled":true,"tileLayout":"horizontal","tileCount":4,"gridColumns":2}')
    expect(migrated).toMatchObject({ rowCount: 1, minimumCapacity: 4 })
    expect(autoBalancedBrowserTileGrid(migrated, browser, display)).toEqual({ columns: 4, rows: 1, capacity: 4 })

    const userChanged = withAutoBalancedBrowserRows(migrated, 1)
    expect(userChanged.minimumCapacity).toBe(1)
    expect(autoBalancedBrowserTileGrid(userChanged, browser, display)).toEqual({ columns: 1, rows: 1, capacity: 1 })
  })

  it('places Chrome in a real two-dimensional grid and scales content in both axes', () => {
    const layout = withAutoBalancedBrowserRows({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }, 3)
    const grid = autoBalancedBrowserTileGrid(layout, browser, display)
    const topLeft = computeBrowserWindowPlacement(layout, browser, display, 0)
    const secondRow = computeBrowserWindowPlacement(layout, browser, display, grid.columns)

    expect(grid).toEqual({ columns: 4, rows: 3, capacity: 12 })
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

  it('limits automatic capacity to the existing 32 Chrome safety ceiling', () => {
    const layout = withAutoBalancedBrowserRows({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }, 32)
    expect(autoBalancedBrowserTileGrid(layout, browser, display)).toEqual({ columns: 1, rows: 32, capacity: 32 })
    expect(computeBrowserWindowPlacement(layout, browser, display, 32)).toBeNull()
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
    expect(parseStoredBrowserWindowLayout('{"tileCount":999}')).toEqual(DEFAULT_BROWSER_WINDOW_LAYOUT)
  })
})
