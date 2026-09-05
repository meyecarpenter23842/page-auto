const ROW_SELECTOR = 'table:not(.account-grid):not(.pt-account-picker-grid) tbody tr, .quick-page-row'
const INTERACTIVE_SELECTOR = 'input,button,select,a,textarea,[contenteditable="true"]'
const ROW_PAINT_EXCLUDED_SELECTOR = '.page-wall-account-table, .page-wall-schedule-account-table'

function isEmptyTableRow(row: HTMLElement): boolean {
  if (row.matches('.quick-page-row')) return false
  const cells = Array.from(row.children).filter((child) => child instanceof HTMLTableCellElement) as HTMLTableCellElement[]
  return cells.length === 1 && cells[0]!.colSpan > 1
}

function pageAccountTable(row: HTMLElement): HTMLTableElement | null {
  if (!row.matches('tr')) return null
  return row.closest<HTMLTableElement>('table.pt-account-grid')
}

function pageAccountEnabledCheckbox(row: HTMLElement): HTMLInputElement | null {
  const table = pageAccountTable(row)
  if (!table) return null
  const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead tr > th'))
  const enabledColumnIndex = headers.findIndex((header) => header.textContent?.trim() === 'Bật')
  if (enabledColumnIndex < 0) return null
  return row.querySelector<HTMLInputElement>(`:scope > td:nth-child(${enabledColumnIndex + 1}) input[type="checkbox"]`)
}

function selectionCheckbox(row: HTMLElement): HTMLInputElement | null {
  const pageEnabled = pageAccountEnabledCheckbox(row)
  if (pageEnabled) return pageEnabled
  if (!row.matches('tr')) return null
  const table = row.closest('table')
  const firstHeader = table?.querySelector<HTMLTableCellElement>('thead tr > th:first-child') ?? null
  if (!firstHeader) return null
  const headerLabel = `${firstHeader.textContent ?? ''} ${firstHeader.getAttribute('aria-label') ?? ''}`.trim().toLocaleLowerCase('vi')
  const headerHasCheckbox = Boolean(firstHeader.querySelector('input[type="checkbox"]'))
  if (!headerHasCheckbox && !headerLabel.includes('chọn')) return null
  return row.querySelector<HTMLInputElement>(':scope > td:first-child input[type="checkbox"]')
}

function pageAccountRows(table: HTMLTableElement): HTMLElement[] {
  return Array.from(table.querySelectorAll<HTMLElement>('tbody > tr')).filter((row) => !isEmptyTableRow(row))
}

function syncPageAccountSummaries(doc: Document): void {
  for (const table of doc.querySelectorAll<HTMLTableElement>('table.pt-account-grid')) {
    const rows = pageAccountRows(table)
    const enabled = rows.filter((row) => pageAccountEnabledCheckbox(row)?.checked === true).length
    const chip = table.closest('.pt-account-panel')?.querySelector<HTMLElement>('.pt-count-chip') ?? null
    if (!chip) continue
    const summary = `${enabled}/${rows.length} bật`
    if (chip.textContent !== summary) chip.textContent = summary
  }
}

export function rowPaintSelected(row: HTMLElement): boolean {
  const pageEnabled = pageAccountEnabledCheckbox(row)
  if (pageEnabled) return pageEnabled.checked
  return row.dataset.rowPaintSelected === 'true'
}

export function setRowPaintSelected(row: HTMLElement, selected: boolean): void {
  const pageEnabled = pageAccountEnabledCheckbox(row)
  if (!pageEnabled) {
    if (selected) row.dataset.rowPaintSelected = 'true'
    else delete row.dataset.rowPaintSelected
  }

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
    if (row.closest(ROW_PAINT_EXCLUDED_SELECTOR)) return null
    return row
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.detail > 1) return
    const target = event.target
    if (!(target instanceof Element) || target.closest(INTERACTIVE_SELECTOR)) return
    const row = resolveRow(target)
    if (!row) return

    const pageAccount = pageAccountTable(row) !== null
    if (pageAccount) event.stopPropagation()
    event.preventDefault()
    paintValue = !rowPaintSelected(row)
    lastRow = row
    setRowPaintSelected(row, paintValue)
    if (pageAccount) doc.defaultView?.setTimeout(() => syncPageAccountSummaries(doc), 0)
  }

  const onPointerOver = (event: PointerEvent) => {
    if (paintValue === null) return
    const row = resolveRow(event.target)
    if (!row || row === lastRow) return
    const pageAccount = pageAccountTable(row) !== null
    if (pageAccount) event.stopPropagation()
    lastRow = row
    setRowPaintSelected(row, paintValue)
    if (pageAccount) doc.defaultView?.setTimeout(() => syncPageAccountSummaries(doc), 0)
  }

  const stopPaint = () => {
    paintValue = null
    lastRow = null
  }

  const MutationObserverCtor = doc.defaultView?.MutationObserver
  const pageAccountObserver = MutationObserverCtor
    ? new MutationObserverCtor(() => syncPageAccountSummaries(doc))
    : null
  if (pageAccountObserver && doc.documentElement) {
    pageAccountObserver.observe(doc.documentElement, { subtree: true, childList: true, characterData: true })
  }
  syncPageAccountSummaries(doc)

  doc.addEventListener('pointerdown', onPointerDown, true)
  doc.addEventListener('pointerover', onPointerOver, true)
  window.addEventListener('pointerup', stopPaint)
  window.addEventListener('pointercancel', stopPaint)
  window.addEventListener('blur', stopPaint)

  return () => {
    pageAccountObserver?.disconnect()
    doc.removeEventListener('pointerdown', onPointerDown, true)
    doc.removeEventListener('pointerover', onPointerOver, true)
    window.removeEventListener('pointerup', stopPaint)
    window.removeEventListener('pointercancel', stopPaint)
    window.removeEventListener('blur', stopPaint)
  }
}
