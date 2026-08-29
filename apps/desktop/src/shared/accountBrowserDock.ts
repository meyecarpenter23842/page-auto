export interface AccountBrowserDockOpenResult {
  status: 'opened' | 'focused' | 'unsupported' | 'error'
  embeddedCount: number
  message: string
}

export interface AccountBrowserDockCell {
  x: number
  y: number
  width: number
  height: number
}

export function computeAccountBrowserDockCells(
  width: number,
  height: number,
  count: number,
  gap = 4
): AccountBrowserDockCell[] {
  const safeCount = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0))
  if (safeCount === 0) return []

  const safeWidth = Math.max(1, Math.floor(Number.isFinite(width) ? width : 1))
  const safeHeight = Math.max(1, Math.floor(Number.isFinite(height) ? height : 1))
  const safeGap = Math.max(0, Math.floor(Number.isFinite(gap) ? gap : 0))
  const columns = Math.max(1, Math.ceil(Math.sqrt(safeCount)))
  const rows = Math.max(1, Math.ceil(safeCount / columns))
  const usableWidth = Math.max(columns, safeWidth - safeGap * (columns + 1))
  const usableHeight = Math.max(rows, safeHeight - safeGap * (rows + 1))
  const cellWidth = Math.max(1, Math.floor(usableWidth / columns))
  const cellHeight = Math.max(1, Math.floor(usableHeight / rows))

  const cells: AccountBrowserDockCell[] = []
  for (let index = 0; index < safeCount; index += 1) {
    const column = index % columns
    const row = Math.floor(index / columns)
    cells.push({
      x: safeGap + column * (cellWidth + safeGap),
      y: safeGap + row * (cellHeight + safeGap),
      width: cellWidth,
      height: cellHeight
    })
  }
  return cells
}
