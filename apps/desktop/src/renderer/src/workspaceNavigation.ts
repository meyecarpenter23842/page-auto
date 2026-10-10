import { useEffect } from 'react'

const ACTIVE_ROUTE_KEY = 'page-auto.ui.active-route.v1'
const pendingWorkspaces = new Map<symbol, string>()

type ReadStorage = Pick<Storage, 'getItem'>
type WriteStorage = Pick<Storage, 'setItem'>

export function readLastWorkspaceRoute<T extends string>(
  routes: readonly T[],
  fallback: T,
  storage?: ReadStorage | null
): T {
  try {
    const source = storage === undefined
      ? typeof window === 'undefined' ? null : window.localStorage
      : storage
    const saved = source?.getItem(ACTIVE_ROUTE_KEY)
    return routes.find((route) => route === saved) ?? fallback
  } catch {
    return fallback
  }
}

export function saveLastWorkspaceRoute(route: string, storage?: WriteStorage | null): void {
  try {
    const target = storage === undefined
      ? typeof window === 'undefined' ? null : window.localStorage
      : storage
    target?.setItem(ACTIVE_ROUTE_KEY, route)
  } catch {
    // A UI preference must never prevent navigation.
  }
}

export function registerUnsavedWorkspace(label: string): () => void {
  const token = Symbol(label)
  pendingWorkspaces.set(token, label)
  return () => { pendingWorkspaces.delete(token) }
}

export function hasUnsavedWorkspaceChanges(): boolean {
  return pendingWorkspaces.size > 0
}

export function confirmWorkspaceNavigation(
  confirmDiscard: (message: string) => boolean = (message) => window.confirm(message)
): boolean {
  if (!hasUnsavedWorkspaceChanges()) return true
  const labels = [...new Set(pendingWorkspaces.values())]
  return confirmDiscard(
    `Có thay đổi chưa lưu ở ${labels.join(', ')}. Chuyển màn có thể làm mất những thay đổi này. Tiếp tục?`
  )
}

/** Register only a boolean/label: no draft, credentials or account values leave the component. */
export function useUnsavedWorkspaceChanges(isDirty: boolean, label: string): void {
  useEffect(() => {
    if (!isDirty) return
    return registerUnsavedWorkspace(label)
  }, [isDirty, label])
}
