import type { BrowserSettings } from './appSettings'

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

const TILE_GAP_PX = 4
const MIN_RENDER_SCALE = 0.08

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.floor(value)))
}

export function browserTileGrid(settings: BrowserSettings): { columns: number; rows: number; capacity: number } {
  const capacity = clampInteger(settings.tileCount, 1, 32)
  if (settings.tileLayout === 'horizontal') return { columns: capacity, rows: 1, capacity }
  if (settings.tileLayout === 'vertical') return { columns: 1, rows: capacity, capacity }

  const columns = clampInteger(settings.gridColumns, 1, capacity)
  return {
    columns,
    rows: Math.ceil(capacity / columns),
    capacity
  }
}

export function compactContentScale(
  settings: BrowserSettings,
  slotWidth: number,
  slotHeight: number
): number {
  const referenceWidth = Math.max(1, settings.windowWidth)
  const referenceHeight = Math.max(1, settings.windowHeight)
  const scale = Math.min(1, slotWidth / referenceWidth, slotHeight / referenceHeight)
  return Math.max(MIN_RENDER_SCALE, Math.round(scale * 1000) / 1000)
}

export function computeBrowserWindowPlacement(
  settings: BrowserSettings,
  display: BrowserDisplayInfo,
  slotIndex: number
): BrowserWindowPlacement | null {
  if (settings.mode !== 'compact') return null

  const grid = browserTileGrid(settings)
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
    contentScale: compactContentScale(settings, slotWidth, slotHeight),
    viewportWidth: settings.windowWidth,
    viewportHeight: settings.windowHeight
  }
}
