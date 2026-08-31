const ROW_SELECTOR = 'table:not(.account-grid) tbody tr, .quick-page-row'
const INTERACTIVE_SELECTOR = 'input,button,select,a,textarea,[contenteditable="true"]'

function isEmptyTableRow(row: HTMLElement): boolean {
  if (row.matches('.quick-page-row')) return false
  const cells = Array.from(row.children).filter((child) => child instanceof HTMLTableCellElement) as HTMLTableCellElement[]
  return cells.length === 1 && cells[0]!.colSpan > 1
}

function selectionCheckbox(row: HTMLElement): HTMLInputElement | null {
  if (!row.matches('tr')) return null
  const table = row.closest('table')
  const firstHeader = table?.querySelector<HTMLTableCellElement>('thead tr > th:first-child') ?? null
  if (!firstHeader) return null
  const headerLabel = `${firstHeader.textContent ?? ''} ${firstHeader.getAttribute('aria-label') ?? ''}`.trim().toLocaleLowerCase('vi')
  const headerHasCheckbox = Boolean(firstHeader.querySelector('input[type="checkbox"]'))
  if (!headerHasCheckbox && !headerLabel.includes('chọn')) return null
  return row.querySelector<HTMLInputElement>(':scope > td:first-child input[type="checkbox"]')
}

export function rowPaintSelected(row: HTMLElement): boolean {
  return row.dataset.rowPaintSelected === 'true'
}

export function setRowPaintSelected(row: HTMLElement, selected: boolean): void {
  if (selected) row.dataset.rowPaintSelected = 'true'
  else delete row.dataset.rowPaintSelected

  const checkbox = selectionCheckbox(row)
  if (!checkbox || checkbox.disabled || checkbox.checked === selected) return
  checkbox.click()
}

export function installRecordRowPaintSelection(doc: Document = document): () => void {
  let paintValue: boolean | null = null
  let lastRow: HTMLElement | null = null

  const resolveRow = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null
    const row = target.closest<HTMLElement>(ROW_SELECTOR)
    if (!row || isEmptyTableRow(row)) return null
    return row
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.detail > 1) return
    const target = event.target
    if (!(target instanceof Element) || target.closest(INTERACTIVE_SELECTOR)) return
    const row = resolveRow(target)
    if (!row) return

    event.preventDefault()
    paintValue = !rowPaintSelected(row)
    lastRow = row
    setRowPaintSelected(row, paintValue)
  }

  const onPointerOver = (event: PointerEvent) => {
    if (paintValue === null) return
    const row = resolveRow(event.target)
    if (!row || row === lastRow) return
    lastRow = row
    setRowPaintSelected(row, paintValue)
  }

  const stopPaint = () => {
    paintValue = null
    lastRow = null
  }

  doc.addEventListener('pointerdown', onPointerDown)
  doc.addEventListener('pointerover', onPointerOver)
  window.addEventListener('pointerup', stopPaint)
  window.addEventListener('pointercancel', stopPaint)
  window.addEventListener('blur', stopPaint)

  return () => {
    doc.removeEventListener('pointerdown', onPointerDown)
    doc.removeEventListener('pointerover', onPointerOver)
    window.removeEventListener('pointerup', stopPaint)
    window.removeEventListener('pointercancel', stopPaint)
    window.removeEventListener('blur', stopPaint)
  }
}
