export const ACCOUNT_BROWSER_DOCK_IPC = {
  open: 'account-browser-dock:open'
} as const

export interface AccountBrowserDockOpenResult {
  status: 'opened' | 'focused' | 'idle' | 'unsupported' | 'error'
  embeddedCount: number
  message: string
}

export interface AccountBrowserDockItemSize {
  width: number
  height: number
}

export interface AccountBrowserDockCell {
  x: number
  y: number
  width: number
  height: number
}

export interface AccountBrowserDockLayout {
  cells: AccountBrowserDockCell[]
  contentWidth: number
  contentHeight: number
}

function safeInteger(value: number, fallback: number, min = 1): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.floor(value))
}

/**
 * Packs Chrome windows left-to-right without ever changing their size.
 * When the manager viewport cannot contain every row/column, content bounds
 * grow and the manager page supplies scrollbars instead of scaling Chrome.
 */
export function computeAccountBrowserDockLayout(
  viewportWidth: number,
  sizes: AccountBrowserDockItemSize[],
  gap = 4
): AccountBrowserDockLayout {
  if (sizes.length === 0) return { cells: [], contentWidth: 1, contentHeight: 1 }

  const safeViewportWidth = safeInteger(viewportWidth, 1)
  const safeGap = Math.max(0, Math.floor(Number.isFinite(gap) ? gap : 0))
  const cells: AccountBrowserDockCell[] = []
  let x = safeGap
  let y = safeGap
  let rowHeight = 0
  let maxRight = safeGap

  for (const rawSize of sizes) {
    const width = safeInteger(rawSize.width, 1)
    const height = safeInteger(rawSize.height, 1)
    const wouldOverflow = x > safeGap && x + width + safeGap > safeViewportWidth
    if (wouldOverflow) {
      x = safeGap
      y += rowHeight + safeGap
      rowHeight = 0
    }

    cells.push({ x, y, width, height })
    maxRight = Math.max(maxRight, x + width)
    rowHeight = Math.max(rowHeight, height)
    x += width + safeGap
  }

  return {
    cells,
    contentWidth: Math.max(safeViewportWidth, maxRight + safeGap),
    contentHeight: Math.max(1, y + rowHeight + safeGap)
  }
}
