import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from './appSettings'
import {
  CHROME_MIN_COMPACT_OUTER_HEIGHT_PX,
  CHROME_MIN_COMPACT_OUTER_SIDE_PX,
  CHROME_MIN_COMPACT_OUTER_WIDTH_PX,
  DEFAULT_BROWSER_WINDOW_LAYOUT,
  DEFAULT_COMPACT_OUTER_HEIGHT_PX,
  DEFAULT_COMPACT_OUTER_SIDE_PX,
  DEFAULT_COMPACT_OUTER_WIDTH_PX,
  MAX_COMPACT_OUTER_SIDE_PX,
  browserTileGrid,
  compactBrowserSlotAssignments,
  compactBrowserTileSize,
  compactContentScale,
  computeBrowserWindowPlacement,
  parseStoredBrowserWindowLayout,
  rectangularBrowserTileGrid,
  squareBrowserTileGrid,
  withCompactBrowserTileSide,
  withCompactBrowserTileSize,
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

  it('uses the Batch 2A native evidence as independent Width×Height guards', () => {
    expect(CHROME_MIN_COMPACT_OUTER_SIDE_PX).toBe(500)
    expect(CHROME_MIN_COMPACT_OUTER_WIDTH_PX).toBe(500)
    expect(CHROME_MIN_COMPACT_OUTER_HEIGHT_PX).toBe(300)
    expect(DEFAULT_COMPACT_OUTER_SIDE_PX).toBe(500)
    expect(DEFAULT_COMPACT_OUTER_WIDTH_PX).toBe(500)
    expect(DEFAULT_COMPACT_OUTER_HEIGHT_PX).toBe(500)
    expect(MAX_COMPACT_OUTER_SIDE_PX).toBeGreaterThanOrEqual(1200)

    expect(withCompactBrowserTileSize(DEFAULT_BROWSER_WINDOW_LAYOUT, 650, 420)).toMatchObject({
      tileWidthPx: 650,
      tileHeightPx: 420
    })
    expect(withCompactBrowserTileSize(DEFAULT_BROWSER_WINDOW_LAYOUT, 1, 1)).toMatchObject({
      tileWidthPx: 500,
      tileHeightPx: 300
    })
    expect(withCompactBrowserTileSide(DEFAULT_BROWSER_WINDOW_LAYOUT, 650)).toMatchObject({
      tileWidthPx: 650,
      tileHeightPx: 650,
      autoFit: false
    })
  })

  it('packs manual 500x400 Chrome windows into a rectangular 3 by 2 grid', () => {
    const layout = withCompactBrowserTileSize({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }, 500, 400)
    expect(rectangularBrowserTileGrid(layout, display, browser)).toEqual({ columns: 3, rows: 2, capacity: 6 })

    const placements = Array.from({ length: 6 }, (_, slotIndex) => computeBrowserWindowPlacement(layout, browser, display, slotIndex))
    expect(placements.every(Boolean)).toBe(true)
    expect(placements[0]).toMatchObject({ x: 306, y: 158, width: 500, height: 400 })
    expect(placements[4]).toMatchObject({ x: 810, y: 562, width: 500, height: 400 })
    expect(placements[5]).toMatchObject({ x: 1314, y: 562, width: 500, height: 400 })
  })

  it('Auto Fit derives native height from the automation desktop aspect ratio without emulation', () => {
    const layout = withCompactBrowserTileSize(
      { ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true },
      500,
      500,
      true
    )
    expect(compactBrowserTileSize(layout, browser)).toEqual({ width: 500, height: 313, autoFit: true })
    expect(rectangularBrowserTileGrid(layout, display, browser)).toEqual({ columns: 3, rows: 3, capacity: 9 })

    const placement = computeBrowserWindowPlacement(layout, browser, display, 0)
    expect(placement).toMatchObject({ width: 500, height: 313 })
    expect(placement?.viewportWidth).toBe(1280)
    expect(placement?.viewportHeight).toBe(800)
  })

  it('changes capacity predictably with manual Width×Height', () => {
    const base = { ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }
    expect(rectangularBrowserTileGrid(withCompactBrowserTileSize(base, 500, 500), display, browser))
      .toEqual({ columns: 3, rows: 2, capacity: 6 })
    expect(rectangularBrowserTileGrid(withCompactBrowserTileSize(base, 500, 350), display, browser))
      .toEqual({ columns: 3, rows: 2, capacity: 6 })
    expect(rectangularBrowserTileGrid(withCompactBrowserTileSize(base, 600, 400), display, browser))
      .toEqual({ columns: 3, rows: 2, capacity: 6 })
    expect(rectangularBrowserTileGrid(withCompactBrowserTileSize(base, 800, 600), display, browser))
      .toEqual({ columns: 2, rows: 1, capacity: 2 })
  })

  it('uses deterministic overflow layers for rectangular windows', () => {
    const layout = withCompactBrowserTileSize({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }, 500, 400)
    const first = computeBrowserWindowPlacement(layout, browser, display, 0)
    const seventh = computeBrowserWindowPlacement(layout, browser, display, 6)
    const twelfth = computeBrowserWindowPlacement(layout, browser, display, 11)

    expect(first).toMatchObject({ x: 306, y: 158, width: 500, height: 400 })
    expect(seventh).toMatchObject({ slotIndex: 6, x: 330, y: 182, width: 500, height: 400 })
    expect(twelfth).toMatchObject({ slotIndex: 11, x: 1290, y: 538, width: 500, height: 400 })
    expect(computeBrowserWindowPlacement(layout, browser, display, 999)).not.toBeNull()
  })

  it('keeps manual Width and Height independent', () => {
    const layout = withCompactBrowserTileSize({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }, 700, 350)
    for (let slotIndex = 0; slotIndex < 8; slotIndex += 1) {
      const placement = computeBrowserWindowPlacement(layout, browser, display, slotIndex)
      expect(placement?.width).toBe(700)
      expect(placement?.height).toBe(350)
    }
  })

  it('keeps content-scale metadata deterministic without enabling viewport emulation', () => {
    expect(compactContentScale(browser, 1280, 800)).toBe(1)
    expect(compactContentScale(browser, 640, 400)).toBe(0.5)
    expect(compactContentScale(browser, 500, 313)).toBeCloseTo(0.391, 3)
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

  it('migrates legacy tileSidePx into Width×Height and preserves new settings', () => {
    expect(parseStoredBrowserWindowLayout('{"enabled":true,"tileLayout":"grid","tileCount":12,"gridColumns":4}'))
      .toMatchObject({ rowCount: 3, gridColumns: 3, tileCount: 9, minimumCapacity: 9, tileWidthPx: 500, tileHeightPx: 500, autoFit: false })
    expect(parseStoredBrowserWindowLayout('{"enabled":true,"tileLayout":"horizontal","tileCount":4}'))
      .toMatchObject({ rowCount: 2, gridColumns: 2, tileCount: 4, tileWidthPx: 500, tileHeightPx: 500 })
    expect(parseStoredBrowserWindowLayout('{"enabled":true,"tileSidePx":650}'))
      .toMatchObject({ tileWidthPx: 650, tileHeightPx: 650, autoFit: false })
    expect(parseStoredBrowserWindowLayout('{"enabled":true,"tileWidthPx":700,"tileHeightPx":350,"autoFit":true}'))
      .toMatchObject({ tileWidthPx: 700, tileHeightPx: 350, autoFit: true })
    expect(parseStoredBrowserWindowLayout('{"tileSidePx":499}')).toEqual(DEFAULT_BROWSER_WINDOW_LAYOUT)
    expect(parseStoredBrowserWindowLayout('{"tileWidthPx":499,"tileHeightPx":300}')).toEqual(DEFAULT_BROWSER_WINDOW_LAYOUT)
    expect(parseStoredBrowserWindowLayout('{"tileWidthPx":500,"tileHeightPx":299}')).toEqual(DEFAULT_BROWSER_WINDOW_LAYOUT)
  })
})
