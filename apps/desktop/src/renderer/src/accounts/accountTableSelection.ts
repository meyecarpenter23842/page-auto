import { type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction, useRef } from 'react'

export const ACCOUNT_TABLE_INTERACTIVE_SELECTOR =
  'input,button,select,a,textarea,[contenteditable="true"],[data-row-interactive="true"]'

export type AccountTableSelectionInteraction = {
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
}

export type AccountTableSelectionState = {
  rangeIds: Set<number>
  anchorId: number | null
  focusId: number | null
}

type UseExcelRowRangeOptions = {
  orderedIds: number[]
  state: AccountTableSelectionState
  setState: Dispatch<SetStateAction<AccountTableSelectionState>>
  interactiveSelector?: string
}

function interactiveTarget(target: EventTarget | null, selector: string) {
  return target instanceof Element ? target.closest(selector) : null
}

export function selectContiguousAccountRange(
  orderedIds: number[],
  anchorId: number,
  focusId: number
) {
  const anchorIndex = orderedIds.indexOf(anchorId)
  const focusIndex = orderedIds.indexOf(focusId)
  if (anchorIndex < 0 || focusIndex < 0) return new Set<number>([focusId])
  const [start, end] = anchorIndex <= focusIndex ? [anchorIndex, focusIndex] : [focusIndex, anchorIndex]
  return new Set(orderedIds.slice(start, end + 1))
}

export function nextExcelRowRange(
  state: AccountTableSelectionState,
  orderedIds: number[],
  rowId: number,
  event: AccountTableSelectionInteraction
): AccountTableSelectionState {
  const rowIndex = orderedIds.indexOf(rowId)
  if (rowIndex < 0) return state

  if (event.shiftKey) {
    const anchorId =
      state.anchorId != null && orderedIds.includes(state.anchorId) ? state.anchorId : rowId
    const next = new Set(state.rangeIds)
    for (const id of selectContiguousAccountRange(orderedIds, anchorId, rowId)) next.add(id)
    return {
      rangeIds: next,
      anchorId,
      focusId: rowId
    }
  }

  const next = new Set(state.rangeIds)
  if (next.has(rowId)) next.delete(rowId)
  else next.add(rowId)
  return {
    rangeIds: next,
    anchorId: rowId,
    focusId: rowId
  }
}

export function useExcelRowRange({
  orderedIds,
  state,
  setState,
  interactiveSelector = ACCOUNT_TABLE_INTERACTIVE_SELECTOR
}: UseExcelRowRangeOptions) {
  const orderedIdsRef = useRef(orderedIds)
  const stateRef = useRef(state)

  orderedIdsRef.current = orderedIds
  stateRef.current = state

  const apply = (next: AccountTableSelectionState) => {
    stateRef.current = next
    setState(next)
  }

  const onRowPointerDown = (rowId: number, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || interactiveTarget(event.target, interactiveSelector)) return
    apply(nextExcelRowRange(stateRef.current, orderedIdsRef.current, rowId, event))
  }

  const onRowPointerEnter = (_rowId: number, _event: ReactPointerEvent<HTMLElement>) => {}

  return {
    onRowPointerDown,
    onRowPointerEnter
  }
}
