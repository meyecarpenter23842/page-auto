import {
  useEffect,
  useMemo,
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
  const additive = Boolean(modifiers.ctrlKey || modifiers.metaKey)
  if (modifiers.shiftKey && anchorId !== null && orderedIds.includes(anchorId)) {
    const next = new Set(additive ? currentIds : [])
    for (const id of rowIdsBetween(orderedIds, anchorId, targetId)) next.add(id)
    return { ids: next, anchorId }
  }

  if (additive) {
    const next = new Set(currentIds)
    if (next.has(targetId)) next.delete(targetId)
    else next.add(targetId)
    return { ids: next, anchorId: targetId }
  }

  return { ids: new Set([targetId]), anchorId: targetId }
}

export function clampContextMenuPoint(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 8
): { x: number; y: number } {
  const maxX = Math.max(padding, viewportWidth - menuWidth - padding)
  const maxY = Math.max(padding, viewportHeight - menuHeight - padding)
  return {
    x: Math.max(padding, Math.min(x, maxX)),
    y: Math.max(padding, Math.min(y, maxY))
  }
}

export function useExcelRowRange(orderedIds: readonly number[]) {
  const [rangeIds, setRangeIds] = useState<Set<number>>(() => new Set())
  const [anchorId, setAnchorId] = useState<number | null>(null)
  const [dragAnchorId, setDragAnchorId] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const orderedKey = useMemo(() => orderedIds.join('|'), [orderedIds])

  useEffect(() => {
    const valid = new Set(orderedIds)
    setRangeIds((current) => new Set([...current].filter((id) => valid.has(id))))
    setAnchorId((current) => current !== null && valid.has(current) ? current : null)
    setDragAnchorId((current) => current !== null && valid.has(current) ? current : null)
  }, [orderedKey])

  useEffect(() => {
    const stopDrag = () => {
      setDragging(false)
      setDragAnchorId(null)
    }
    window.addEventListener('pointerup', stopDrag)
    window.addEventListener('pointercancel', stopDrag)
    window.addEventListener('blur', stopDrag)
    return () => {
      window.removeEventListener('pointerup', stopDrag)
      window.removeEventListener('pointercancel', stopDrag)
      window.removeEventListener('blur', stopDrag)
    }
  }, [])

  const onRowPointerDown = (event: ReactPointerEvent<HTMLElement>, accountId: number) => {
    if (event.button !== 0 || event.detail > 1) return
    const target = event.target as HTMLElement
    if (target.closest(INTERACTIVE_SELECTOR)) return
    event.preventDefault()

    const next = nextExcelRowRange(orderedIds, rangeIds, anchorId, accountId, event)
    setRangeIds(next.ids)
    setAnchorId(next.anchorId)

    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
      setDragging(true)
      setDragAnchorId(accountId)
    } else {
      setDragging(false)
      setDragAnchorId(null)
    }
  }

  const onRowPointerEnter = (accountId: number) => {
    if (!dragging || dragAnchorId === null) return
    setRangeIds(new Set(rowIdsBetween(orderedIds, dragAnchorId, accountId)))
  }

  const ensureContextRow = (accountId: number) => {
    if (rangeIds.has(accountId)) return
    setRangeIds(new Set([accountId]))
    setAnchorId(accountId)
    setDragging(false)
    setDragAnchorId(null)
  }

  const clearRange = () => {
    setRangeIds(new Set())
    setAnchorId(null)
    setDragging(false)
    setDragAnchorId(null)
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
