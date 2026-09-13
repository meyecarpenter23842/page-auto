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

export function useExcelRowRange(orderedIds: readonly number[]) {
  const [rangeIds, setRangeIds] = useState<Set<number>>(() => new Set())
  const [anchorId, setAnchorId] = useState<number | null>(null)
  const rangeIdsRef = useRef(rangeIds)
  const anchorIdRef = useRef(anchorId)
  const dragRef = useRef<{
    startId: number
    baseIds: Set<number>
    mode: ExcelDragMode
    anchorId: number
  } | null>(null)
  const orderedKey = useMemo(() => orderedIds.join('|'), [orderedIds])

  const applyRange = (next: ExcelRowRangeState) => {
    rangeIdsRef.current = next.ids
    anchorIdRef.current = next.anchorId
    setRangeIds(next.ids)
    setAnchorId(next.anchorId)
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

  useEffect(() => {
    const endDrag = () => { dragRef.current = null }
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    window.addEventListener('blur', endDrag)
    return () => {
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
      window.removeEventListener('blur', endDrag)
    }
  }, [])

  const onRowPointerDown = (event: ReactPointerEvent<HTMLElement>, accountId: number) => {
    if (event.button !== 0 || event.detail > 1) return
    const target = event.target as HTMLElement
    if (target.closest(INTERACTIVE_SELECTOR)) return
    event.preventDefault()

    const currentIds = rangeIdsRef.current
    const currentAnchor = anchorIdRef.current
    const additive = event.ctrlKey || event.metaKey
    const shiftAnchor = event.shiftKey && currentAnchor !== null && orderedIds.includes(currentAnchor)
      ? currentAnchor
      : accountId
    const mode: ExcelDragMode = additive && !event.shiftKey && currentIds.has(accountId) ? 'remove' : 'add'
    const baseIds = additive ? new Set(currentIds) : new Set<number>()
    dragRef.current = { startId: shiftAnchor, baseIds, mode, anchorId: shiftAnchor }
    applyRange(nextExcelRowRange(orderedIds, currentIds, currentAnchor, accountId, event))
  }

  const onRowPointerEnter = (accountId: number) => {
    const drag = dragRef.current
    if (!drag) return
    applyRange({
      ids: nextExcelDragRange(orderedIds, drag.baseIds, drag.startId, accountId, drag.mode),
      anchorId: drag.anchorId
    })
  }

  const ensureContextRow = (accountId: number) => {
    if (rangeIdsRef.current.has(accountId)) return
    applyRange({ ids: new Set([accountId]), anchorId: accountId })
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
