import type { BrowserSettings } from './appSettings'

export const BROWSER_WINDOW_LAYOUT_STORAGE_KEY = 'settings.browser-window-layout'
export const BROWSER_TILE_LAYOUTS = ['horizontal', 'vertical', 'grid'] as const
export type BrowserTileLayout = (typeof BROWSER_TILE_LAYOUTS)[number]

export interface BrowserWindowLayoutSettings {
  enabled: boolean
  tileLayout: BrowserTileLayout
  tileCount: number
  gridColumns: number
  rowCount: number
  minimumCapacity: number
  targetDisplayId: number | null
}

const MAX_SQUARE_SIDE = 8
const MAX_TILE_COUNT = MAX_SQUARE_SIDE * MAX_SQUARE_SIDE
const MAX_GRID_COLUMNS = MAX_SQUARE_SIDE

export const DEFAULT_BROWSER_WINDOW_LAYOUT: Readonly<BrowserWindowLayoutSettings> = {
  enabled: false,
  tileLayout: 'grid',
  tileCount: 4,
  gridColumns: 2,
  rowCount: 2,
  minimumCapacity: 1,
  targetDisplayId: null
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

const TILE_GAP_PX = 4
const MIN_RENDER_SCALE = 0.001

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.floor(value)))
}

export function cloneDefaultBrowserWindowLayout(): BrowserWindowLayoutSettings {
  return { ...DEFAULT_BROWSER_WINDOW_LAYOUT }
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

  // Releases before square-grid mode persisted rowCount for horizontal/vertical
  // layouts too. Their rowCount describes the old one-axis layout, not the new
  // square side, so preserve capacity by deriving the smallest N x N that fits it.
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

    const nextRows = migratedRows(parsed)
    const next: BrowserWindowLayoutSettings = {
      ...cloneDefaultBrowserWindowLayout(),
      ...parsed,
      tileLayout: 'grid',
      rowCount: nextRows,
      gridColumns: nextRows,
      tileCount: nextRows * nextRows,
      minimumCapacity: nextRows * nextRows
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

/** FPlus-style compact rule: choosing N vertical rows always produces an N × N grid. */
export function squareBrowserTileGrid(settings: BrowserWindowLayoutSettings): BrowserTileGrid {
  const side = clampInteger(settings.rowCount, 1, MAX_SQUARE_SIDE)
  return { columns: side, rows: side, capacity: side * side }
}

/** Compatibility alias for code/config introduced by the previous auto-balance implementation. */
export function autoBalancedBrowserTileGrid(
  settings: BrowserWindowLayoutSettings,
  _browser: BrowserSettings,
  _display: BrowserDisplayInfo
): BrowserTileGrid {
  return squareBrowserTileGrid(settings)
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
 * Compact windows are physically square. We choose the largest square side that can
 * fit the complete N × N grid inside the selected display work area, then center the
 * grid. Chrome's own title bar / automation infobar is intentionally left intact;
 * browserRuntime measures the real inner content area after launch and fits Facebook
 * into the remaining space instead of pretending the browser chrome does not exist.
 */
export function computeBrowserWindowPlacement(
  layout: BrowserWindowLayoutSettings,
  browser: BrowserSettings,
  display: BrowserDisplayInfo,
  slotIndex: number
): BrowserWindowPlacement | null {
  if (!layout.enabled) return null

  const grid = squareBrowserTileGrid(layout)
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= grid.capacity) return null

  const gapX = TILE_GAP_PX * Math.max(0, grid.columns - 1)
  const gapY = TILE_GAP_PX * Math.max(0, grid.rows - 1)
  const usableWidth = Math.max(1, display.workArea.width - gapX)
  const usableHeight = Math.max(1, display.workArea.height - gapY)
  const side = Math.max(1, Math.floor(Math.min(usableWidth / grid.columns, usableHeight / grid.rows)))
  const gridWidth = side * grid.columns + gapX
  const gridHeight = side * grid.rows + gapY
  const originX = display.workArea.x + Math.max(0, Math.floor((display.workArea.width - gridWidth) / 2))
  const originY = display.workArea.y + Math.max(0, Math.floor((display.workArea.height - gridHeight) / 2))
  const column = slotIndex % grid.columns
  const row = Math.floor(slotIndex / grid.columns)

  return {
    displayId: display.id,
    slotIndex,
    x: originX + column * (side + TILE_GAP_PX),
    y: originY + row * (side + TILE_GAP_PX),
    width: side,
    height: side,
    contentScale: compactContentScale(browser, side, side),
    viewportWidth: browser.windowWidth,
    viewportHeight: browser.windowHeight
  }
}
