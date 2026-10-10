import type { PageTabSummary } from '../../../shared/pageTabs'
import type { RotationRuntimeSnapshot, RotationRuntimeStatus } from '../../../shared/rotation'

export type BulkPageAction = 'start' | 'pause' | 'resume' | 'stop'
export type SelectionMode = 'toggle' | 'range'

export function updatePageCheckedIds(
  current: ReadonlySet<number>,
  visibleIds: readonly number[],
  targetId: number,
  mode: SelectionMode,
  anchorId: number | null,
  shouldCheck?: boolean
): Set<number> {
  const result = new Set(current)
  if (!visibleIds.includes(targetId)) return result
  const shouldAdd = shouldCheck ?? !result.has(targetId)
  const start = mode === 'range' && anchorId !== null ? visibleIds.indexOf(anchorId) : -1
  const end = visibleIds.indexOf(targetId)
  const scope = mode === 'range' && start >= 0
    ? visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1)
    : [targetId]
  for (const id of scope) {
    if (shouldAdd) result.add(id)
    else result.delete(id)
  }
  return result
}

export function eligibleForBulkAction(status: RotationRuntimeStatus, action: BulkPageAction): boolean {
  if (action === 'start') return ['idle', 'completed', 'stopped', 'error'].includes(status)
  if (action === 'pause') return ['starting', 'running', 'waiting_window'].includes(status)
  if (action === 'resume') return status === 'paused'
  return ['starting', 'running', 'paused', 'waiting_window'].includes(status)
}

export function eligibleSelectedPageIds(
  pages: readonly PageTabSummary[],
  selectedIds: ReadonlySet<number>,
  runtimeById: Readonly<Record<number, RotationRuntimeSnapshot>>,
  action: BulkPageAction
): number[] {
  return pages
    .filter((page) => selectedIds.has(page.id) && eligibleForBulkAction(runtimeById[page.id]?.status ?? 'idle', action))
    .map((page) => page.id)
}
