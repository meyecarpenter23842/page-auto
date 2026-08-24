import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from './appSettings'
import {
  DEFAULT_BROWSER_WINDOW_LAYOUT,
  browserTileGrid,
  compactBrowserSlotAssignments,
  compactContentScale,
  computeBrowserWindowPlacement,
  parseStoredBrowserWindowLayout,
  withBrowserGridDimensions,
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
  it('splits the real monitor working area horizontally and excludes the taskbar through workArea', () => {
    const layout = { ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true, tileLayout: 'horizontal' as const, tileCount: 4 }
    expect(browserTileGrid(layout)).toEqual({ columns: 4, rows: 1, capacity: 4 })

    const first = computeBrowserWindowPlacement(layout, browser, display, 0)
    const fourth = computeBrowserWindowPlacement(layout, browser, display, 3)
    expect(first).toMatchObject({ displayId: 7, slotIndex: 0, x: 100, y: 40, height: 1040 })
    expect(fourth?.x).toBeGreaterThan(first?.x ?? 0)
    expect((fourth?.x ?? 0) + (fourth?.width ?? 0)).toBeLessThanOrEqual(2020)
  })

  it('supports legacy vertical layouts and real two-dimensional grids', () => {
    expect(browserTileGrid({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true, tileLayout: 'vertical', tileCount: 5 }))
      .toEqual({ columns: 1, rows: 5, capacity: 5 })
    expect(browserTileGrid({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true, tileLayout: 'grid', tileCount: 6, gridColumns: 3 }))
      .toEqual({ columns: 3, rows: 2, capacity: 6 })
  })

  it('upgrades dimension edits to a 4 x 3 or 2 x 6 grid instead of forcing one full-screen axis', () => {
    const fourByThree = withBrowserGridDimensions(
      { ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true, tileLayout: 'horizontal', tileCount: 4 },
      4,
      3
    )
    const twoBySix = withBrowserGridDimensions(fourByThree, 2, 6)

    expect(fourByThree).toMatchObject({ tileLayout: 'grid', gridColumns: 4, tileCount: 12 })
    expect(browserTileGrid(fourByThree)).toEqual({ columns: 4, rows: 3, capacity: 12 })
    expect(twoBySix).toMatchObject({ tileLayout: 'grid', gridColumns: 2, tileCount: 12 })
    expect(browserTileGrid(twoBySix)).toEqual({ columns: 2, rows: 6, capacity: 12 })

    const topLeft = computeBrowserWindowPlacement(fourByThree, browser, display, 0)
    const secondRow = computeBrowserWindowPlacement(fourByThree, browser, display, 4)
    expect(topLeft?.width).toBeLessThan(display.workArea.width)
    expect(topLeft?.height).toBeLessThan(display.workArea.height)
    expect(secondRow?.y).toBeGreaterThan(topLeft?.y ?? 0)
    expect(topLeft?.contentScale).toBeLessThan(1)
  })

  it('scales the page content down with the physical slot instead of keeping a huge cropped page', () => {
    expect(compactContentScale(browser, 1280, 800)).toBe(1)
    expect(compactContentScale(browser, 640, 400)).toBe(0.5)
    expect(compactContentScale(browser, 320, 200)).toBe(0.25)

    const placement = computeBrowserWindowPlacement(
      withBrowserGridDimensions({ ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true }, 4, 3),
      browser,
      { ...display, workArea: { x: 0, y: 0, width: 1920, height: 800 } },
      0
    )
    expect(placement?.viewportWidth).toBe(1280)
    expect(placement?.viewportHeight).toBe(800)
    expect(placement?.width).toBeLessThan(1920)
    expect(placement?.height).toBeLessThan(800)
    expect(placement?.contentScale).toBeLessThan(1)
  })

  it('allows every supported tile count to compute the scale it actually needs', () => {
    const placement = computeBrowserWindowPlacement(
      { ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true, tileLayout: 'horizontal', tileCount: 32 },
      browser,
      { ...display, workArea: { x: 0, y: 0, width: 1920, height: 800 } },
      0
    )
    expect(placement?.contentScale).toBeLessThan(0.08)
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

  it('returns no placement outside capacity and safely falls back on invalid stored config', () => {
    const layout = { ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true, tileCount: 2 }
    expect(computeBrowserWindowPlacement(layout, browser, display, 2)).toBeNull()
    expect(parseStoredBrowserWindowLayout('{"tileCount":999}')).toEqual(DEFAULT_BROWSER_WINDOW_LAYOUT)
  })
})
