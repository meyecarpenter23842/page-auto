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
const MAX_TILE_COUNT = 36
const MAX_GRID_COLUMNS = 16
export const MAX_COMPACT_GRID_SIDE = Math.floor(Math.sqrt(MAX_TILE_COUNT))

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
  if (!Number.isInteger(value.rowCount) || value.rowCount < 1 || value.rowCount > MAX_COMPACT_GRID_SIDE) {
    throw new Error(`Số hàng dọc phải từ 1 đến ${MAX_COMPACT_GRID_SIDE}.`)
  }
  if (!Number.isInteger(value.minimumCapacity) || value.minimumCapacity < 1 || value.minimumCapacity > MAX_TILE_COUNT) {
    throw new Error(`Sức chứa tối thiểu phải từ 1 đến ${MAX_TILE_COUNT}.`)
  }
  if (value.targetDisplayId !== null && !Number.isInteger(value.targetDisplayId)) {
    throw new Error('Màn hình đích không hợp lệ.')
  }
}

function legacyRows(parsed: Partial<BrowserWindowLayoutSettings>): number {
  const capacity = clampInteger(parsed.tileCount ?? DEFAULT_BROWSER_WINDOW_LAYOUT.tileCount, 1, MAX_TILE_COUNT)
  if (parsed.tileLayout === 'vertical') return clampInteger(capacity, 1, MAX_COMPACT_GRID_SIDE)
  if (parsed.tileLayout === 'horizontal') return 1
  const columns = clampInteger(parsed.gridColumns ?? DEFAULT_BROWSER_WINDOW_LAYOUT.gridColumns, 1, Math.min(MAX_GRID_COLUMNS, capacity))
  return clampInteger(Math.ceil(capacity / columns), 1, MAX_COMPACT_GRID_SIDE)
}

export function parseStoredBrowserWindowLayout(raw: string | undefined): BrowserWindowLayoutSettings {
  if (!raw) return cloneDefaultBrowserWindowLayout()
  try {
    const parsed = JSON.parse(raw) as Partial<BrowserWindowLayoutSettings>
    const next: BrowserWindowLayoutSettings = {
      ...cloneDefaultBrowserWindowLayout(),
      ...parsed,
      rowCount: clampInteger(parsed.rowCount ?? legacyRows(parsed), 1, MAX_COMPACT_GRID_SIDE),
      minimumCapacity: parsed.minimumCapacity === undefined
        ? clampInteger(parsed.tileCount ?? 1, 1, MAX_TILE_COUNT)
        : parsed.minimumCapacity
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

/**
 * Compact layout follows the FPlus-style square rule: the operator chooses only N
 * vertical rows and PAGE-AUTO uses N columns as well. The monitor aspect ratio never
 * changes the chosen shape. minimumCapacity only helps migrate older saved layouts
 * into the smallest square that can still hold their previous slot count.
 */
export function squareBrowserTileGrid(settings: BrowserWindowLayoutSettings): BrowserTileGrid {
  const requestedSide = clampInteger(settings.rowCount, 1, MAX_COMPACT_GRID_SIDE)
  const migrationSide = clampInteger(Math.ceil(Math.sqrt(settings.minimumCapacity)), 1, MAX_COMPACT_GRID_SIDE)
  const side = Math.max(requestedSide, migrationSide)
  return { columns: side, rows: side, capacity: side * side }
}

/** Compatibility wrapper for existing call sites while Compact migrated from auto-aspect to square layout. */
export function autoBalancedBrowserTileGrid(
  settings: BrowserWindowLayoutSettings,
  _browser: BrowserSettings,
  _display: BrowserDisplayInfo
): BrowserTileGrid {
  return squareBrowserTileGrid(settings)
}

export function withAutoBalancedBrowserRows(
  settings: BrowserWindowLayoutSettings,
  rows: number
): BrowserWindowLayoutSettings {
  return {
    ...settings,
    tileLayout: 'grid',
    rowCount: clampInteger(rows, 1, MAX_COMPACT_GRID_SIDE),
    minimumCapacity: 1
  }
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
  const slotWidth = Math.max(1, Math.floor((display.workArea.width - gapX) / grid.columns))
  const slotHeight = Math.max(1, Math.floor((display.workArea.height - gapY) / grid.rows))
  const column = slotIndex % grid.columns
  const row = Math.floor(slotIndex / grid.columns)

  return {
    displayId: display.id,
    slotIndex,
    x: display.workArea.x + column * (slotWidth + TILE_GAP_PX),
    y: display.workArea.y + row * (slotHeight + TILE_GAP_PX),
    width: slotWidth,
    height: slotHeight,
    contentScale: compactContentScale(browser, slotWidth, slotHeight),
    viewportWidth: browser.windowWidth,
    viewportHeight: browser.windowHeight
  }
}
