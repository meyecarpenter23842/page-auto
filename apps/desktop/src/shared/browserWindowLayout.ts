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
/** Batch 2A live/CI evidence: Chrome clamps requested width below 500, while 300px height is accepted. */
export const CHROME_MIN_COMPACT_OUTER_WIDTH_PX = 500
export const CHROME_MIN_COMPACT_OUTER_HEIGHT_PX = 300
/** Legacy square constant retained for stored config/import compatibility. */
export const CHROME_MIN_COMPACT_OUTER_SIDE_PX = CHROME_MIN_COMPACT_OUTER_WIDTH_PX
export const DEFAULT_COMPACT_OUTER_SIDE_PX = 500
export const DEFAULT_COMPACT_OUTER_WIDTH_PX = 500
export const DEFAULT_COMPACT_OUTER_HEIGHT_PX = 500
export const MAX_COMPACT_OUTER_SIDE_PX = 1600
export const MAX_COMPACT_OUTER_WIDTH_PX = MAX_COMPACT_OUTER_SIDE_PX
export const MAX_COMPACT_OUTER_HEIGHT_PX = MAX_COMPACT_OUTER_SIDE_PX

export interface BrowserWindowLayoutSettings {
  enabled: boolean
  tileLayout: BrowserTileLayout
  tileCount: number
  gridColumns: number
  rowCount: number
  minimumCapacity: number
  targetDisplayId: number | null
  /** Legacy square side. New saves use tileWidthPx/tileHeightPx. */
  tileSidePx?: number
  tileWidthPx?: number
  tileHeightPx?: number
  /** Keep width native and derive height from the configured desktop automation aspect ratio. */
  autoFit?: boolean
}

export const DEFAULT_BROWSER_WINDOW_LAYOUT: Readonly<BrowserWindowLayoutSettings> = {
  enabled: false,
  tileLayout: 'grid',
  tileCount: 4,
  gridColumns: 2,
  rowCount: 2,
  minimumCapacity: 1,
  targetDisplayId: null,
  tileWidthPx: DEFAULT_COMPACT_OUTER_WIDTH_PX,
  tileHeightPx: DEFAULT_COMPACT_OUTER_HEIGHT_PX,
  autoFit: false
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
  /** Runtime-only whole-Chrome device scale. Omitted for manual/native Compact placement. */
  wholeChromeScale?: number
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

export interface BrowserTileSize {
  width: number
  height: number
  autoFit: boolean
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

function requestedTileWidth(settings: BrowserWindowLayoutSettings): number {
  return settings.tileWidthPx ?? settings.tileSidePx ?? DEFAULT_COMPACT_OUTER_WIDTH_PX
}

function requestedTileHeight(settings: BrowserWindowLayoutSettings): number {
  return settings.tileHeightPx ?? settings.tileSidePx ?? DEFAULT_COMPACT_OUTER_HEIGHT_PX
}

/** Legacy helper: returns the requested width for old square callers. */
export function compactBrowserTileSidePx(settings: BrowserWindowLayoutSettings): number {
  return clampInteger(
    requestedTileWidth(settings),
    CHROME_MIN_COMPACT_OUTER_WIDTH_PX,
    MAX_COMPACT_OUTER_WIDTH_PX
  )
}

export function compactBrowserTileSize(
  settings: BrowserWindowLayoutSettings,
  browser?: BrowserSettings,
  display?: BrowserDisplayInfo
): BrowserTileSize {
  const width = clampInteger(
    requestedTileWidth(settings),
    CHROME_MIN_COMPACT_OUTER_WIDTH_PX,
    MAX_COMPACT_OUTER_WIDTH_PX
  )
  let height = clampInteger(
    requestedTileHeight(settings),
    CHROME_MIN_COMPACT_OUTER_HEIGHT_PX,
    MAX_COMPACT_OUTER_HEIGHT_PX
  )
  const autoFit = settings.autoFit === true

  if (autoFit && browser) {
    const aspectHeight = Math.round(width * Math.max(1, browser.windowHeight) / Math.max(1, browser.windowWidth))
    height = clampInteger(aspectHeight, CHROME_MIN_COMPACT_OUTER_HEIGHT_PX, MAX_COMPACT_OUTER_HEIGHT_PX)
  }

  if (!display) return { width, height, autoFit }
  return {
    width: Math.max(1, Math.min(width, Math.max(1, display.workArea.width))),
    height: Math.max(1, Math.min(height, Math.max(1, display.workArea.height))),
    autoFit
  }
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
  if (value.autoFit !== undefined && typeof value.autoFit !== 'boolean') {
    throw new Error('Auto Fit Chrome không hợp lệ.')
  }
  if (value.tileSidePx !== undefined && (
    !Number.isInteger(value.tileSidePx)
    || value.tileSidePx < CHROME_MIN_COMPACT_OUTER_SIDE_PX
    || value.tileSidePx > MAX_COMPACT_OUTER_SIDE_PX
  )) {
    throw new Error(`Kích thước vuông cũ phải từ ${CHROME_MIN_COMPACT_OUTER_SIDE_PX} đến ${MAX_COMPACT_OUTER_SIDE_PX}px.`)
  }
  if (value.tileWidthPx !== undefined && (
    !Number.isInteger(value.tileWidthPx)
    || value.tileWidthPx < CHROME_MIN_COMPACT_OUTER_WIDTH_PX
    || value.tileWidthPx > MAX_COMPACT_OUTER_WIDTH_PX
  )) {
    throw new Error(`Chiều rộng Chrome phải từ ${CHROME_MIN_COMPACT_OUTER_WIDTH_PX} đến ${MAX_COMPACT_OUTER_WIDTH_PX}px.`)
  }
  if (value.tileHeightPx !== undefined && (
    !Number.isInteger(value.tileHeightPx)
    || value.tileHeightPx < CHROME_MIN_COMPACT_OUTER_HEIGHT_PX
    || value.tileHeightPx > MAX_COMPACT_OUTER_HEIGHT_PX
  )) {
    throw new Error(`Chiều cao Chrome phải từ ${CHROME_MIN_COMPACT_OUTER_HEIGHT_PX} đến ${MAX_COMPACT_OUTER_HEIGHT_PX}px.`)
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
    assertStoredNumberInRange(parsed.tileWidthPx, CHROME_MIN_COMPACT_OUTER_WIDTH_PX, MAX_COMPACT_OUTER_WIDTH_PX)
    assertStoredNumberInRange(parsed.tileHeightPx, CHROME_MIN_COMPACT_OUTER_HEIGHT_PX, MAX_COMPACT_OUTER_HEIGHT_PX)
    if (parsed.autoFit !== undefined && typeof parsed.autoFit !== 'boolean') throw new Error('Stored autoFit is invalid.')

    const nextRows = migratedRows(parsed)
    const legacySide = parsed.tileSidePx
    const next: BrowserWindowLayoutSettings = {
      ...cloneDefaultBrowserWindowLayout(),
      ...parsed,
      tileLayout: 'grid',
      rowCount: nextRows,
      gridColumns: nextRows,
      tileCount: nextRows * nextRows,
      minimumCapacity: nextRows * nextRows,
      tileWidthPx: parsed.tileWidthPx ?? legacySide ?? DEFAULT_COMPACT_OUTER_WIDTH_PX,
      tileHeightPx: parsed.tileHeightPx ?? legacySide ?? DEFAULT_COMPACT_OUTER_HEIGHT_PX,
      autoFit: parsed.autoFit ?? false
    }
    delete next.tileSidePx
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
  const widthRows = Math.floor((Math.max(1, display.workArea.width) + TILE_GAP_PX) / (CHROME_MIN_COMPACT_OUTER_WIDTH_PX + TILE_GAP_PX))
  const heightRows = Math.floor((Math.max(1, display.workArea.height) + TILE_GAP_PX) / (DEFAULT_COMPACT_OUTER_HEIGHT_PX + TILE_GAP_PX))
  return clampInteger(Math.min(widthRows, heightRows), 1, MAX_SQUARE_SIDE)
}

/** Compatibility helper retained for old callers. */
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

/** Legacy square setter retained for callers outside the settings screen. */
export function withCompactBrowserTileSide(
  settings: BrowserWindowLayoutSettings,
  sidePx: number
): BrowserWindowLayoutSettings {
  const side = clampInteger(sidePx, CHROME_MIN_COMPACT_OUTER_SIDE_PX, MAX_COMPACT_OUTER_SIDE_PX)
  return withCompactBrowserTileSize(settings, side, side, false)
}

export function withCompactBrowserTileSize(
  settings: BrowserWindowLayoutSettings,
  widthPx: number,
  heightPx: number,
  autoFit: boolean = settings.autoFit === true
): BrowserWindowLayoutSettings {
  const next = {
    ...settings,
    tileWidthPx: clampInteger(widthPx, CHROME_MIN_COMPACT_OUTER_WIDTH_PX, MAX_COMPACT_OUTER_WIDTH_PX),
    tileHeightPx: clampInteger(heightPx, CHROME_MIN_COMPACT_OUTER_HEIGHT_PX, MAX_COMPACT_OUTER_HEIGHT_PX),
    autoFit
  }
  delete next.tileSidePx
  return next
}

/** Legacy helper: returns effective width. */
export function effectiveBrowserTileSidePx(
  settings: BrowserWindowLayoutSettings,
  display: BrowserDisplayInfo
): number {
  return compactBrowserTileSize(settings, undefined, display).width
}

/** Pack physical Width×Height Chrome windows into the rectangular monitor work area. */
export function rectangularBrowserTileGrid(
  settings: BrowserWindowLayoutSettings,
  display: BrowserDisplayInfo,
  browser?: BrowserSettings
): BrowserTileGrid {
  const size = compactBrowserTileSize(settings, browser, display)
  const columns = Math.max(1, Math.floor((Math.max(1, display.workArea.width) + TILE_GAP_PX) / (size.width + TILE_GAP_PX)))
  const rows = Math.max(1, Math.floor((Math.max(1, display.workArea.height) + TILE_GAP_PX) / (size.height + TILE_GAP_PX)))
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
 * Compact windows use fixed physical Width×Height bounds. When the visible layer is full,
 * later browsers reuse deterministic slots with an inward cascade offset.
 */
export function computeBrowserWindowPlacement(
  layout: BrowserWindowLayoutSettings,
  browser: BrowserSettings,
  display: BrowserDisplayInfo,
  slotIndex: number
): BrowserWindowPlacement | null {
  if (!layout.enabled) return null
  if (!Number.isInteger(slotIndex) || slotIndex < 0) return null

  const size = compactBrowserTileSize(layout, browser, display)
  const grid = rectangularBrowserTileGrid(layout, display, browser)
  const visibleSlotIndex = slotIndex % grid.capacity
  const layerIndex = Math.floor(slotIndex / grid.capacity)

  const gapX = TILE_GAP_PX * Math.max(0, grid.columns - 1)
  const gapY = TILE_GAP_PX * Math.max(0, grid.rows - 1)
  const gridWidth = size.width * grid.columns + gapX
  const gridHeight = size.height * grid.rows + gapY
  const originX = display.workArea.x + Math.max(0, Math.floor((display.workArea.width - gridWidth) / 2))
  const originY = display.workArea.y + Math.max(0, Math.floor((display.workArea.height - gridHeight) / 2))
  const column = visibleSlotIndex % grid.columns
  const row = Math.floor(visibleSlotIndex / grid.columns)
  const baseX = originX + column * (size.width + TILE_GAP_PX)
  const baseY = originY + row * (size.height + TILE_GAP_PX)

  let x = baseX
  let y = baseY
  if (layerIndex > 0) {
    const cascadeStep = ((layerIndex - 1) % OVERFLOW_CASCADE_STEPS + 1) * OVERFLOW_CASCADE_STEP_PX
    const directionX = column === grid.columns - 1 ? -1 : 1
    const directionY = row === grid.rows - 1 ? -1 : 1
    const minX = display.workArea.x
    const minY = display.workArea.y
    const maxX = display.workArea.x + Math.max(0, display.workArea.width - size.width)
    const maxY = display.workArea.y + Math.max(0, display.workArea.height - size.height)
    x = clampPosition(baseX + directionX * cascadeStep, minX, maxX)
    y = clampPosition(baseY + directionY * cascadeStep, minY, maxY)
  }

  return {
    displayId: display.id,
    slotIndex,
    x,
    y,
    width: size.width,
    height: size.height,
    contentScale: compactContentScale(browser, size.width, size.height),
    viewportWidth: browser.windowWidth,
    viewportHeight: browser.windowHeight
  }
}
