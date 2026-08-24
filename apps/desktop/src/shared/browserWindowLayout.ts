import type { BrowserSettings } from './appSettings'

export const BROWSER_WINDOW_LAYOUT_STORAGE_KEY = 'settings.browser-window-layout'
export const BROWSER_TILE_LAYOUTS = ['horizontal', 'vertical', 'grid'] as const
export type BrowserTileLayout = (typeof BROWSER_TILE_LAYOUTS)[number]

export interface BrowserWindowLayoutSettings {
  enabled: boolean
  tileLayout: BrowserTileLayout
  tileCount: number
  gridColumns: number
  targetDisplayId: number | null
}

export const DEFAULT_BROWSER_WINDOW_LAYOUT: Readonly<BrowserWindowLayoutSettings> = {
  enabled: false,
  tileLayout: 'horizontal',
  tileCount: 4,
  gridColumns: 2,
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

const TILE_GAP_PX = 4
const MIN_RENDER_SCALE = 0.08

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
  if (!Number.isInteger(value.tileCount) || value.tileCount < 1 || value.tileCount > 32) {
    throw new Error('Số ô Chrome phải từ 1 đến 32.')
  }
  if (!Number.isInteger(value.gridColumns) || value.gridColumns < 1 || value.gridColumns > 16) {
    throw new Error('Số cột Grid phải từ 1 đến 16.')
  }
  if (value.targetDisplayId !== null && !Number.isInteger(value.targetDisplayId)) {
    throw new Error('Màn hình đích không hợp lệ.')
  }
}

export function parseStoredBrowserWindowLayout(raw: string | undefined): BrowserWindowLayoutSettings {
  if (!raw) return cloneDefaultBrowserWindowLayout()
  try {
    const parsed = JSON.parse(raw) as Partial<BrowserWindowLayoutSettings>
    const next: BrowserWindowLayoutSettings = {
      ...cloneDefaultBrowserWindowLayout(),
      ...parsed
    }
    assertValidBrowserWindowLayoutSettings(next)
    return next
  } catch {
    return cloneDefaultBrowserWindowLayout()
  }
}

export function browserTileGrid(settings: BrowserWindowLayoutSettings): { columns: number; rows: number; capacity: number } {
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
  browser: BrowserSettings,
  slotWidth: number,
  slotHeight: number
): number {
  const referenceWidth = Math.max(1, browser.windowWidth)
  const referenceHeight = Math.max(1, browser.windowHeight)
  const scale = Math.min(1, slotWidth / referenceWidth, slotHeight / referenceHeight)
  return Math.max(MIN_RENDER_SCALE, Math.round(scale * 1000) / 1000)
}

export function computeBrowserWindowPlacement(
  layout: BrowserWindowLayoutSettings,
  browser: BrowserSettings,
  display: BrowserDisplayInfo,
  slotIndex: number
): BrowserWindowPlacement | null {
  if (!layout.enabled) return null

  const grid = browserTileGrid(layout)
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
