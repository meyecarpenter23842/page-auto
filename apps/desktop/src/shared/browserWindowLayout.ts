import type { BrowserSettings } from './appSettings'

export const BROWSER_WINDOW_LAYOUT_STORAGE_KEY = 'settings.browser-window-layout'
export const BROWSER_TILE_LAYOUTS = ['horizontal', 'vertical', 'grid'] as const
export type BrowserTileLayout = (typeof BROWSER_TILE_LAYOUTS)[number]

const MAX_SQUARE_SIDE = 8
const MAX_TILE_COUNT = MAX_SQUARE_SIDE * MAX_SQUARE_SIDE
const MAX_GRID_COLUMNS = MAX_SQUARE_SIDE
const TILE_GAP_PX = 4
const MIN_RENDER_SCALE = 0.001
const OVERFLOW_CASCADE_STEP_PX = 24
const OVERFLOW_CASCADE_STEPS = 4
/** Chrome desktop currently clamps normal browser windows to roughly 500px minimum width. */
export const CHROME_MIN_COMPACT_OUTER_SIDE_PX = 500
export const DEFAULT_COMPACT_OUTER_SIDE_PX = 500
export const MAX_COMPACT_OUTER_SIDE_PX = 1600

export interface BrowserWindowLayoutSettings {
  enabled: boolean
  tileLayout: BrowserTileLayout
  tileCount: number
  gridColumns: number
  rowCount: number
  minimumCapacity: number
  targetDisplayId: number | null
  /** Physical square side requested for each compact Chrome window. Optional for stored-layout compatibility. */
  tileSidePx?: number
}

export const DEFAULT_BROWSER_WINDOW_LAYOUT: Readonly<BrowserWindowLayoutSettings> = {
  enabled: false,
  tileLayout: 'grid',
  tileCount: 4,
  gridColumns: 2,
  rowCount: 2,
  minimumCapacity: 1,
  targetDisplayId: null,
  tileSidePx: DEFAULT_COMPACT_OUTER_SIDE_PX
}

export interface BrowserWorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserDisplayInfo {
  id: number
  label: string
  isPrimary: boolean
  scaleFactor: number
  workArea: BrowserWorkArea
}

export interface BrowserWindowPlacement {
  displayId: number
  slotIndex: number
  x: number
  y: number
  width: number
  height: number
  contentScale: number
  viewportWidth: number
  viewportHeight: number
}

export interface BrowserRetileResult {
  status: 'success' | 'not_compact' | 'no_browsers'
  appliedCount: number
  overflowCount: number
  message: string
}

export interface BrowserSlotAssignment {
  accountId: number
  slotIndex: number
}

export interface BrowserTileGrid {
  columns: number
  rows: number
  capacity: number
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function clampPosition(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function cloneDefaultBrowserWindowLayout(): BrowserWindowLayoutSettings {
  return { ...DEFAULT_BROWSER_WINDOW_LAYOUT }
}

export function compactBrowserTileSidePx(settings: BrowserWindowLayoutSettings): number {
  return clampInteger(
    settings.tileSidePx ?? DEFAULT_COMPACT_OUTER_SIDE_PX,
    CHROME_MIN_COMPACT_OUTER_SIDE_PX,
    MAX_COMPACT_OUTER_SIDE_PX
  )
}

export function assertValidBrowserWindowLayoutSettings(value: BrowserWindowLayoutSettings): void {
  if (typeof value.enabled !== 'boolean') throw new Error('browserWindowLayout.enabled phải là boolean.')
  if (!BROWSER_TILE_LAYOUTS.includes(value.tileLayout)) throw new Error('Kiểu chia cửa sổ Chrome không hợp lệ.')
  if (!Number.isInteger(value.tileCount) || value.tileCount < 1 || value.tileCount > MAX_TILE_COUNT) {
    throw new Error(`Số ô Chrome phải từ 1 đến ${MAX_TILE_COUNT}.`)
  }
  if (!Number.isInteger(value.gridColumns) || value.gridColumns < 1 || value.gridColumns > MAX_GRID_COLUMNS) {
    throw new Error(`Số cột Grid phải từ 1 đến ${MAX_GRID_COLUMNS}.`)
  }
  if (!Number.isInteger(value.rowCount) || value.rowCount < 1 || value.rowCount > MAX_SQUARE_SIDE) {
    throw new Error(`Số hàng dọc phải từ 1 đến ${MAX_SQUARE_SIDE}.`)
  }
  if (!Number.isInteger(value.minimumCapacity) || value.minimumCapacity < 1 || value.minimumCapacity > MAX_TILE_COUNT) {
    throw new Error(`Sức chứa tối thiểu phải từ 1 đến ${MAX_TILE_COUNT}.`)
  }
  if (value.targetDisplayId !== null && !Number.isInteger(value.targetDisplayId)) {
    throw new Error('Màn hình đích không hợp lệ.')
  }
  if (value.tileSidePx !== undefined && (
    !Number.isInteger(value.tileSidePx)
    || value.tileSidePx < CHROME_MIN_COMPACT_OUTER_SIDE_PX
    || value.tileSidePx > MAX_COMPACT_OUTER_SIDE_PX
  )) {
    throw new Error(`Kích thước Chrome phải từ ${CHROME_MIN_COMPACT_OUTER_SIDE_PX} đến ${MAX_COMPACT_OUTER_SIDE_PX}px.`)
  }
}

function assertStoredNumberInRange(value: number | undefined, min: number, max: number): void {
  if (value === undefined) return
  if (!Number.isInteger(value) || value < min || value > max) throw new Error('Stored browser layout is out of range.')
}

function squareSideForCapacity(capacity: number): number {
  return Math.min(MAX_SQUARE_SIDE, Math.max(1, Math.ceil(Math.sqrt(capacity))))
}

function migratedRows(parsed: Partial<BrowserWindowLayoutSettings>): number {
  const capacity = clampInteger(parsed.tileCount ?? DEFAULT_BROWSER_WINDOW_LAYOUT.tileCount, 1, MAX_TILE_COUNT)

  if (parsed.tileLayout === 'horizontal' || parsed.tileLayout === 'vertical') {
    return squareSideForCapacity(capacity)
  }

  if (parsed.rowCount !== undefined) return parsed.rowCount

  const columns = clampInteger(
    parsed.gridColumns ?? DEFAULT_BROWSER_WINDOW_LAYOUT.gridColumns,
    1,
    Math.min(MAX_GRID_COLUMNS, capacity)
  )
  return Math.min(MAX_SQUARE_SIDE, Math.ceil(capacity / columns))
}

export function parseStoredBrowserWindowLayout(raw: string | undefined): BrowserWindowLayoutSettings {
  if (!raw) return cloneDefaultBrowserWindowLayout()
  try {
    const parsed = JSON.parse(raw) as Partial<BrowserWindowLayoutSettings>
    assertStoredNumberInRange(parsed.tileCount, 1, MAX_TILE_COUNT)
    assertStoredNumberInRange(parsed.gridColumns, 1, MAX_GRID_COLUMNS)
    assertStoredNumberInRange(parsed.rowCount, 1, MAX_SQUARE_SIDE)
    assertStoredNumberInRange(parsed.minimumCapacity, 1, MAX_TILE_COUNT)
    assertStoredNumberInRange(parsed.tileSidePx, CHROME_MIN_COMPACT_OUTER_SIDE_PX, MAX_COMPACT_OUTER_SIDE_PX)

    const nextRows = migratedRows(parsed)
    const next: BrowserWindowLayoutSettings = {
      ...cloneDefaultBrowserWindowLayout(),
      ...parsed,
      tileLayout: 'grid',
      rowCount: nextRows,
      gridColumns: nextRows,
      tileCount: nextRows * nextRows,
      minimumCapacity: nextRows * nextRows,
      tileSidePx: parsed.tileSidePx ?? DEFAULT_COMPACT_OUTER_SIDE_PX
    }
    assertValidBrowserWindowLayoutSettings(next)
    return next
  } catch {
    return cloneDefaultBrowserWindowLayout()
  }
}

/** Legacy/manual grid resolver kept so older stored layouts can be interpreted safely. */
export function browserTileGrid(settings: BrowserWindowLayoutSettings): BrowserTileGrid {
  const capacity = clampInteger(settings.tileCount, 1, MAX_TILE_COUNT)
  if (settings.tileLayout === 'horizontal') return { columns: capacity, rows: 1, capacity }
  if (settings.tileLayout === 'vertical') return { columns: 1, rows: capacity, capacity }

  const columns = clampInteger(settings.gridColumns, 1, Math.min(MAX_GRID_COLUMNS, capacity))
  return {
    columns,
    rows: Math.ceil(capacity / columns),
    capacity
  }
}

/** Compatibility helper for the previous N×N configuration model. */
export function squareBrowserTileGrid(settings: BrowserWindowLayoutSettings): BrowserTileGrid {
  const side = clampInteger(settings.rowCount, 1, MAX_SQUARE_SIDE)
  return { columns: side, rows: side, capacity: side * side }
}

/** Compatibility helper retained for old tests/config migration. */
export function maximumTrueSquareRows(display: BrowserDisplayInfo): number {
  const widthRows = Math.floor((Math.max(1, display.workArea.width) + TILE_GAP_PX) / (CHROME_MIN_COMPACT_OUTER_SIDE_PX + TILE_GAP_PX))
  const heightRows = Math.floor((Math.max(1, display.workArea.height) + TILE_GAP_PX) / (CHROME_MIN_COMPACT_OUTER_SIDE_PX + TILE_GAP_PX))
  return clampInteger(Math.min(widthRows, heightRows), 1, MAX_SQUARE_SIDE)
}

/** Compatibility helper retained for old callers; new physical placement uses rectangular packing by tile side. */
export function effectiveSquareBrowserTileGrid(
  settings: BrowserWindowLayoutSettings,
  display: BrowserDisplayInfo
): BrowserTileGrid {
  const requested = squareBrowserTileGrid(settings)
  const side = Math.min(requested.rows, maximumTrueSquareRows(display))
  return { columns: side, rows: side, capacity: side * side }
}

/** Compatibility alias for code/config introduced by the previous auto-balance implementation. */
export function autoBalancedBrowserTileGrid(
  settings: BrowserWindowLayoutSettings,
  _browser: BrowserSettings,
  display: BrowserDisplayInfo
): BrowserTileGrid {
  return effectiveSquareBrowserTileGrid(settings, display)
}

export function withSquareBrowserRows(
  settings: BrowserWindowLayoutSettings,
  rows: number
): BrowserWindowLayoutSettings {
  const side = clampInteger(rows, 1, MAX_SQUARE_SIDE)
  return {
    ...settings,
    tileLayout: 'grid',
    rowCount: side,
    gridColumns: side,
    tileCount: side * side,
    minimumCapacity: side * side
  }
}

/** Compatibility alias for the previous helper name. */
export function withAutoBalancedBrowserRows(
  settings: BrowserWindowLayoutSettings,
  rows: number
): BrowserWindowLayoutSettings {
  return withSquareBrowserRows(settings, rows)
}

export function withCompactBrowserTileSide(
  settings: BrowserWindowLayoutSettings,
  sidePx: number
): BrowserWindowLayoutSettings {
  return {
    ...settings,
    tileSidePx: clampInteger(sidePx, CHROME_MIN_COMPACT_OUTER_SIDE_PX, MAX_COMPACT_OUTER_SIDE_PX)
  }
}

export function effectiveBrowserTileSidePx(
  settings: BrowserWindowLayoutSettings,
  display: BrowserDisplayInfo
): number {
  const requested = compactBrowserTileSidePx(settings)
  return Math.max(1, Math.min(requested, Math.max(1, display.workArea.width), Math.max(1, display.workArea.height)))
}

/**
 * Pack physical square Chrome windows into the rectangular monitor work area.
 * The window remains square; only the number of columns/rows follows the display shape.
 */
export function rectangularBrowserTileGrid(
  settings: BrowserWindowLayoutSettings,
  display: BrowserDisplayInfo
): BrowserTileGrid {
  const side = effectiveBrowserTileSidePx(settings, display)
  const columns = Math.max(1, Math.floor((Math.max(1, display.workArea.width) + TILE_GAP_PX) / (side + TILE_GAP_PX)))
  const rows = Math.max(1, Math.floor((Math.max(1, display.workArea.height) + TILE_GAP_PX) / (side + TILE_GAP_PX)))
  return { columns, rows, capacity: columns * rows }
}

export function compactBrowserSlotAssignments(assignments: readonly BrowserSlotAssignment[]): BrowserSlotAssignment[] {
  return [...assignments]
    .sort((a, b) => a.slotIndex - b.slotIndex || a.accountId - b.accountId)
    .map((assignment, slotIndex) => ({ accountId: assignment.accountId, slotIndex }))
}

export function compactContentScale(
  browser: BrowserSettings,
  slotWidth: number,
  slotHeight: number
): number {
  const referenceWidth = Math.max(1, browser.windowWidth)
  const referenceHeight = Math.max(1, browser.windowHeight)
  const scale = Math.min(1, Math.max(1, slotWidth) / referenceWidth, Math.max(1, slotHeight) / referenceHeight)
  return Math.max(MIN_RENDER_SCALE, Math.round(scale * 1000) / 1000)
}

/**
 * Compact windows use a fixed physical square side and rectangular packing. When the
 * visible layer is full, later browsers reuse deterministic slots with an inward
 * cascade offset instead of returning null and letting Chrome open at a random/default size.
 */
export function computeBrowserWindowPlacement(
  layout: BrowserWindowLayoutSettings,
  browser: BrowserSettings,
  display: BrowserDisplayInfo,
  slotIndex: number
): BrowserWindowPlacement | null {
  if (!layout.enabled) return null
  if (!Number.isInteger(slotIndex) || slotIndex < 0) return null

  const grid = rectangularBrowserTileGrid(layout, display)
  const side = effectiveBrowserTileSidePx(layout, display)
  const visibleSlotIndex = slotIndex % grid.capacity
  const layerIndex = Math.floor(slotIndex / grid.capacity)

  const gapX = TILE_GAP_PX * Math.max(0, grid.columns - 1)
  const gapY = TILE_GAP_PX * Math.max(0, grid.rows - 1)
  const gridWidth = side * grid.columns + gapX
  const gridHeight = side * grid.rows + gapY
  const originX = display.workArea.x + Math.max(0, Math.floor((display.workArea.width - gridWidth) / 2))
  const originY = display.workArea.y + Math.max(0, Math.floor((display.workArea.height - gridHeight) / 2))
  const column = visibleSlotIndex % grid.columns
  const row = Math.floor(visibleSlotIndex / grid.columns)
  const baseX = originX + column * (side + TILE_GAP_PX)
  const baseY = originY + row * (side + TILE_GAP_PX)

  let x = baseX
  let y = baseY
  if (layerIndex > 0) {
    const cascadeStep = ((layerIndex - 1) % OVERFLOW_CASCADE_STEPS + 1) * OVERFLOW_CASCADE_STEP_PX
    const directionX = column === grid.columns - 1 ? -1 : 1
    const directionY = row === grid.rows - 1 ? -1 : 1
    const minX = display.workArea.x
    const minY = display.workArea.y
    const maxX = display.workArea.x + Math.max(0, display.workArea.width - side)
    const maxY = display.workArea.y + Math.max(0, display.workArea.height - side)
    x = clampPosition(baseX + directionX * cascadeStep, minX, maxX)
    y = clampPosition(baseY + directionY * cascadeStep, minY, maxY)
  }

  return {
    displayId: display.id,
    slotIndex,
    x,
    y,
    width: side,
    height: side,
    contentScale: compactContentScale(browser, side, side),
    viewportWidth: browser.windowWidth,
    viewportHeight: browser.windowHeight
  }
}
