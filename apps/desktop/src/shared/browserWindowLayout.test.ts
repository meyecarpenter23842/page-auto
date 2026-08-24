import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from './appSettings'
import {
  CHROME_MIN_COMPACT_OUTER_SIDE_PX,
  DEFAULT_BROWSER_WINDOW_LAYOUT,
  DEFAULT_COMPACT_OUTER_SIDE_PX,
  MAX_COMPACT_OUTER_SIDE_PX,
  browserTileGrid,
  compactBrowserSlotAssignments,
  compactContentScale,
  computeBrowserWindowPlacement,
  parseStoredBrowserWindowLayout,
  rectangularBrowserTileGrid,
  squareBrowserTileGrid,
  withCompactBrowserTileSide,
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
  it('keeps the legacy manual resolver and square helpers available for stored-layout compatibility', () => {
    expect(browserTileGrid({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, tileLayout: 'horizontal', tileCount: 4 }))
      .toEqual({ columns: 4, rows: 1, capacity: 4 })
    expect(squareBrowserTileGrid(withSquareBrowserRows(DEFAULT_BROWSER_WINDOW_LAYOUT, 3)))
      .toEqual({ columns: 3, rows: 3, capacity: 9 })
  })

  it('defaults to a real Chrome-safe 500px square and validates useful manual sizes', () => {
    expect(CHROME_MIN_COMPACT_OUTER_SIDE_PX).toBe(500)
    expect(DEFAULT_COMPACT_OUTER_SIDE_PX).toBe(500)
    expect(MAX_COMPACT_OUTER_SIDE_PX).toBeGreaterThanOrEqual(1200)
    expect(withCompactBrowserTileSide(DEFAULT_BROWSER_WINDOW_LAYOUT, 650).tileSidePx).toBe(650)
    expect(withCompactBrowserTileSide(DEFAULT_BROWSER_WINDOW_LAYOUT, 1).tileSidePx).toBe(CHROME_MIN_COMPACT_OUTER_SIDE_PX)
  })

  it('packs 500px square Chrome windows into a rectangular 3 by 2 grid on a 1080p-class work area', () => {
    const layout = { ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true, tileSidePx: 500 }
    expect(rectangularBrowserTileGrid(layout, display)).toEqual({ columns: 3, rows: 2, capacity: 6 })

    const placements = Array.from({ length: 6 }, (_, slotIndex) => computeBrowserWindowPlacement(layout, browser, display, slotIndex))
    expect(placements.every(Boolean)).toBe(true)
    expect(placements[0]).toMatchObject({ x: 306, y: 58, width: 500, height: 500 })
    expect(placements[4]).toMatchObject({ x: 810, y: 562, width: 500, height: 500 })
    expect(placements[5]).toMatchObject({ x: 1314, y: 562, width: 500, height: 500 })
  })

  it('changes capacity predictably when the operator chooses a different square side', () => {
    const base = { ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }
    expect(rectangularBrowserTileGrid({ ...base, tileSidePx: 500 }, display)).toEqual({ columns: 3, rows: 2, capacity: 6 })
    expect(rectangularBrowserTileGrid({ ...base, tileSidePx: 600 }, display)).toEqual({ columns: 3, rows: 1, capacity: 3 })
    expect(rectangularBrowserTileGrid({ ...base, tileSidePx: 800 }, display)).toEqual({ columns: 2, rows: 1, capacity: 2 })
  })

  it('uses deterministic overflow layers instead of returning null after visible capacity', () => {
    const layout = { ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true, tileSidePx: 500 }
    const first = computeBrowserWindowPlacement(layout, browser, display, 0)
    const seventh = computeBrowserWindowPlacement(layout, browser, display, 6)
    const twelfth = computeBrowserWindowPlacement(layout, browser, display, 11)

    expect(first).toMatchObject({ x: 306, y: 58, width: 500, height: 500 })
    expect(seventh).toMatchObject({ slotIndex: 6, x: 330, y: 82, width: 500, height: 500 })
    expect(twelfth).toMatchObject({ slotIndex: 11, x: 1290, y: 538, width: 500, height: 500 })
    expect(computeBrowserWindowPlacement(layout, browser, display, 999)).not.toBeNull()
  })

  it('keeps every placement square even when the work area is not square', () => {
    const layout = { ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true, tileSidePx: 500 }
    for (let slotIndex = 0; slotIndex < 12; slotIndex += 1) {
      const placement = computeBrowserWindowPlacement(layout, browser, display, slotIndex)
      expect(placement?.width).toBe(placement?.height)
      expect(placement?.width).toBe(500)
    }
  })

  it('scales page content down with the physical slot instead of keeping a huge cropped page', () => {
    expect(compactContentScale(browser, 1280, 800)).toBe(1)
    expect(compactContentScale(browser, 640, 400)).toBe(0.5)
    expect(compactContentScale(browser, 500, 500)).toBeCloseTo(0.391, 3)
  })

  it('compacts sparse active slots before retiling so browsers fill holes in stable order', () => {
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

  it('migrates old layouts to the new default physical side without losing stored compatibility fields', () => {
    expect(parseStoredBrowserWindowLayout('{"enabled":true,"tileLayout":"grid","tileCount":12,"gridColumns":4}'))
      .toMatchObject({ rowCount: 3, gridColumns: 3, tileCount: 9, minimumCapacity: 9, tileSidePx: 500 })
    expect(parseStoredBrowserWindowLayout('{"enabled":true,"tileLayout":"horizontal","tileCount":4}'))
      .toMatchObject({ rowCount: 2, gridColumns: 2, tileCount: 4, tileSidePx: 500 })
    expect(parseStoredBrowserWindowLayout('{"enabled":true,"tileSidePx":650}'))
      .toMatchObject({ tileSidePx: 650 })
    expect(parseStoredBrowserWindowLayout('{"tileSidePx":499}')).toEqual(DEFAULT_BROWSER_WINDOW_LAYOUT)
  })
})
