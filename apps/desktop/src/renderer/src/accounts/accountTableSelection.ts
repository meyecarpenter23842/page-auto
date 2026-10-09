import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'

export interface ExcelRowRangeState {
  ids: Set<number>
  anchorId: number | null
}

export interface ExcelRowRangeModifiers {
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

export type ExcelDragMode = 'add' | 'remove'

const INTERACTIVE_SELECTOR = 'input,button,select,a,textarea,[contenteditable="true"]'

/** Vertical pixels/frame, constrained to the scrollable viewport under the mouse. */
export function edgeAutoScrollDelta(
  pointerY: number, top: number, bottom: number,
  scrollTop: number, scrollHeight: number, clientHeight: number, edgeSize = 44
): number {
  if (bottom <= top || scrollHeight <= clientHeight + 1) return 0
  const band = Math.min(edgeSize, Math.max(12, (bottom - top) / 3))
  if (pointerY < top + band && scrollTop > 0) {
    return -Math.min(24, Math.max(4, Math.round((top + band - pointerY) / band * 18)))
  }
  if (pointerY > bottom - band && scrollTop < scrollHeight - clientHeight) {
    return Math.min(24, Math.max(4, Math.round((pointerY - bottom + band) / band * 18)))
  }
  return 0
}

/** Avoid scrolling the app shell when only a grid's own viewport should move. */
function findVerticalScrollHost(start: HTMLElement): HTMLElement | null {
  for (let node: HTMLElement | null = start.parentElement; node; node = node.parentElement) {
    if (node.scrollHeight <= node.clientHeight + 1) continue
    if (/auto|scroll|overlay/.test(window.getComputedStyle(node).overflowY)) return node
  }
  const root = document.scrollingElement
  return root instanceof HTMLElement && root.scrollHeight > root.clientHeight + 1 ? root : null
}

export function rowIdsBetween(orderedIds: readonly number[], startId: number, endId: number): number[] {
  const start = orderedIds.indexOf(startId)
  const end = orderedIds.indexOf(endId)
  if (start < 0 || end < 0) return [endId]
  return orderedIds.slice(Math.min(start, end), Math.max(start, end) + 1)
}

export function nextExcelRowRange(
  orderedIds: readonly number[],
  currentIds: ReadonlySet<number>,
  anchorId: number | null,
  targetId: number,
  modifiers: ExcelRowRangeModifiers = {}
): ExcelRowRangeState {
  if (modifiers.shiftKey && anchorId !== null && orderedIds.includes(anchorId)) {
    const next = modifiers.ctrlKey || modifiers.metaKey ? new Set(currentIds) : new Set<number>()
    for (const id of rowIdsBetween(orderedIds, anchorId, targetId)) next.add(id)
    return { ids: next, anchorId }
  }

  if (!modifiers.ctrlKey && !modifiers.metaKey) {
    return { ids: new Set([targetId]), anchorId: targetId }
  }

  const next = new Set(currentIds)
  if (next.has(targetId)) next.delete(targetId)
  else next.add(targetId)
  return { ids: next, anchorId: targetId }
}

export function nextExcelDragRange(
  orderedIds: readonly number[],
  baseIds: ReadonlySet<number>,
  startId: number,
  targetId: number,
  mode: ExcelDragMode
): Set<number> {
  const next = new Set(baseIds)
  for (const id of rowIdsBetween(orderedIds, startId, targetId)) {
    if (mode === 'remove') next.delete(id)
    else next.add(id)
  }
  return next
}

export function clampContextMenuPoint(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 8,
  gap = 4
): { x: number; y: number } {
  const maxX = Math.max(padding, viewportWidth - menuWidth - padding)
  const maxY = Math.max(padding, viewportHeight - menuHeight - padding)
  const preferredX = x + gap + menuWidth <= viewportWidth - padding ? x + gap : x - menuWidth - gap
  const preferredY = y + gap + menuHeight <= viewportHeight - padding ? y + gap : y - menuHeight - gap
  return {
    x: Math.max(padding, Math.min(preferredX, maxX)),
    y: Math.max(padding, Math.min(preferredY, maxY))
  }
}

// checkedIds is the canonical target list for bulk actions. The highlight is only visual.
export function useExcelRowRange(
  orderedIds: readonly number[],
  checkedIds?: ReadonlySet<number>,
  onCheckedChange?: (ids: Set<number>) => void
) {
  const [rangeIds, setRangeIds] = useState<Set<number>>(() => new Set())
  const [anchorId, setAnchorId] = useState<number | null>(null)
  const rangeIdsRef = useRef(rangeIds)
  const anchorIdRef = useRef(anchorId)
  const dragRef = useRef<{
    startId: number
    baseIds: Set<number>
    mode: ExcelDragMode
    anchorId: number
    pointerId: number
    pointerX: number
    pointerY: number
    lastTargetId: number
    rowsRoot: HTMLTableSectionElement | null
    scrollHost: HTMLElement | null
  } | null>(null)
  const orderedIdsRef = useRef(orderedIds)
  const checkedChangeRef = useRef(onCheckedChange)
  const processPointerRef = useRef<(autoScroll: boolean) => void>(() => {})
  const startFrameRef = useRef<() => void>(() => {})
  orderedIdsRef.current = orderedIds
  checkedChangeRef.current = onCheckedChange
  const orderedKey = useMemo(() => orderedIds.join('|'), [orderedIds])

  const applyRange = (next: ExcelRowRangeState, syncChecked = false) => {
    rangeIdsRef.current = next.ids
    anchorIdRef.current = next.anchorId
    setRangeIds(next.ids)
    setAnchorId(next.anchorId)
    if (syncChecked) checkedChangeRef.current?.(new Set(next.ids))
  }

  useEffect(() => {
    const valid = new Set(orderedIds)
    const ids = new Set([...rangeIdsRef.current].filter((id) => valid.has(id)))
    const nextAnchor = anchorIdRef.current !== null && valid.has(anchorIdRef.current) ? anchorIdRef.current : null
    rangeIdsRef.current = ids
    anchorIdRef.current = nextAnchor
    dragRef.current = null
    setRangeIds(ids)
    setAnchorId(nextAnchor)
  }, [orderedKey])

  // Row pointer-enter events stop outside the viewport; drive both hit tests and
  // edge scrolling from the same mouse drag across all grids using this hook.
  const processPointer = (autoScroll: boolean) => {
    const drag = dragRef.current
    if (!drag || !drag.rowsRoot || !drag.scrollHost) return
    const host = drag.scrollHost
    const rect = host.getBoundingClientRect()
    if (autoScroll) {
      const dy = edgeAutoScrollDelta(drag.pointerY, rect.top, rect.bottom, host.scrollTop, host.scrollHeight, host.clientHeight)
      if (dy) host.scrollTop += dy
    }
    // On Windows, an overflowing grid can show both scrollbars. elementFromPoint()
    // over the horizontal scrollbar returns the scroller, not a row, even though
    // pointer movement is correctly advancing scrollTop. Hit-test the *content*
    // box (clientWidth/clientHeight), excluding scrollbar gutters on both axes.
    const hitLeft = rect.left + host.clientLeft + 4
    const hitRight = Math.min(rect.right - 4, rect.left + host.clientLeft + host.clientWidth - 5)
    const hitTop = rect.top + host.clientTop + 4
    const hitBottom = Math.min(rect.bottom - 4, rect.top + host.clientTop + host.clientHeight - 5)
    const headerBottom = drag.rowsRoot.closest('table')?.tHead?.getBoundingClientRect().bottom ?? rect.top
    const minY = Math.min(hitBottom, Math.max(hitTop, headerBottom + 3))
    const x = Math.max(hitLeft, Math.min(drag.pointerX, Math.max(hitLeft, hitRight)))
    const y = Math.max(minY, Math.min(drag.pointerY, hitBottom))
    const element = document.elementFromPoint(
      Math.max(1, Math.min(x, window.innerWidth - 2)),
      Math.max(1, Math.min(y, window.innerHeight - 2))
    )
    const row = element?.closest<HTMLElement>('[data-excel-row-id]')
    if (!row || !drag.rowsRoot.contains(row)) return
    const id = Number(row.dataset.excelRowId)
    if (!Number.isFinite(id) || !orderedIdsRef.current.includes(id) || drag.lastTargetId === id) return
    drag.lastTargetId = id
    applyRange({
      ids: nextExcelDragRange(orderedIdsRef.current, drag.baseIds, drag.startId, id, drag.mode),
      anchorId: drag.anchorId
    }, true)
  }
  processPointerRef.current = processPointer

  useEffect(() => {
    let frameId: number | null = null
    const frame = () => {
      if (!dragRef.current) { frameId = null; return }
      processPointerRef.current(true)
      frameId = window.requestAnimationFrame(frame)
    }
    startFrameRef.current = () => {
      if (frameId === null) frameId = window.requestAnimationFrame(frame)
    }
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      if (event.pointerType === 'mouse' && !(event.buttons & 1)) { dragRef.current = null; return }
      drag.pointerX = event.clientX
      drag.pointerY = event.clientY
      processPointerRef.current(false)
    }
    const endDrag = () => { dragRef.current = null }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    window.addEventListener('blur', endDrag)
    return () => {
      dragRef.current = null
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      startFrameRef.current = () => {}
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
      window.removeEventListener('blur', endDrag)
    }
  }, [])

  const onRowPointerDown = (event: ReactPointerEvent<HTMLElement>, accountId: number) => {
    if (event.button !== 0 || event.detail > 1 || event.pointerType === 'touch') return
    const target = event.target as HTMLElement
    if (target.closest(INTERACTIVE_SELECTOR)) return
    event.preventDefault()

    const currentIds = checkedIds ?? rangeIdsRef.current
    const currentAnchor = anchorIdRef.current
    const additive = event.ctrlKey || event.metaKey
    const shiftAnchor = event.shiftKey && currentAnchor !== null && orderedIds.includes(currentAnchor)
      ? currentAnchor
      : accountId
    const mode: ExcelDragMode = additive && !event.shiftKey && currentIds.has(accountId) ? 'remove' : 'add'
    const baseIds = additive ? new Set(currentIds) : new Set<number>()
    dragRef.current = {
      startId: shiftAnchor, baseIds, mode, anchorId: shiftAnchor,
      pointerId: event.pointerId, pointerX: event.clientX, pointerY: event.clientY,
      lastTargetId: accountId,
      rowsRoot: event.currentTarget.closest('tbody'),
      scrollHost: findVerticalScrollHost(event.currentTarget)
    }
    applyRange(nextExcelRowRange(orderedIds, currentIds, currentAnchor, accountId, event), true)
    startFrameRef.current()
  }

  const onRowPointerEnter = (accountId: number) => {
    const drag = dragRef.current
    if (!drag || drag.lastTargetId === accountId) return
    drag.lastTargetId = accountId
    applyRange({
      ids: nextExcelDragRange(orderedIds, drag.baseIds, drag.startId, accountId, drag.mode),
      anchorId: drag.anchorId
    }, true)
  }

  const ensureContextRow = (accountId: number) => {
    // Right-click inside an existing checked selection must preserve the whole batch.
    if (checkedIds?.has(accountId)) return
    if (rangeIdsRef.current.has(accountId) && !onCheckedChange) return
    applyRange({ ids: new Set([accountId]), anchorId: accountId }, true)
  }

  const clearRange = () => {
    applyRange({ ids: new Set(), anchorId: null })
  }

  return {
    rangeIds,
    anchorId,
    onRowPointerDown,
    onRowPointerEnter,
    ensureContextRow,
    clearRange
  }
}
