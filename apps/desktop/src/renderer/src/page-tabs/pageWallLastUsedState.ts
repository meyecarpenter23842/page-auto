export interface PageWallLastUsedState {
  selectedAccountIds: number[]
  accountConcurrency: number
  runDelaySeconds: number
}

interface LastUsedStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const STORAGE_PREFIX = 'page-auto.page-wall.last-used.'

export function pageWallLastUsedStorageKey(pageTabId: number): string {
  return `${STORAGE_PREFIX}${pageTabId}`
}

function browserStorage(): LastUsedStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

export function normalizePageWallLastUsedState(value: unknown): PageWallLastUsedState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<PageWallLastUsedState>
  if (!Array.isArray(candidate.selectedAccountIds)) return null

  const seen = new Set<number>()
  const selectedAccountIds = candidate.selectedAccountIds.flatMap((accountId) => {
    if (!Number.isSafeInteger(accountId) || accountId <= 0 || seen.has(accountId)) return []
    seen.add(accountId)
    return [accountId]
  })

  return {
    selectedAccountIds,
    accountConcurrency: clampInteger(candidate.accountConcurrency, 1, 20, 1),
    runDelaySeconds: clampInteger(candidate.runDelaySeconds, 0, 3600, 0)
  }
}

export function loadPageWallLastUsedState(
  pageTabId: number,
  storage: LastUsedStorage | null = browserStorage()
): PageWallLastUsedState | null {
  if (!Number.isSafeInteger(pageTabId) || pageTabId <= 0 || !storage) return null
  try {
    const raw = storage.getItem(pageWallLastUsedStorageKey(pageTabId))
    if (!raw) return null
    return normalizePageWallLastUsedState(JSON.parse(raw))
  } catch {
    return null
  }
}

export function savePageWallLastUsedState(
  pageTabId: number,
  state: PageWallLastUsedState,
  storage: LastUsedStorage | null = browserStorage()
): void {
  if (!Number.isSafeInteger(pageTabId) || pageTabId <= 0 || !storage) return
  const normalized = normalizePageWallLastUsedState(state)
  if (!normalized) return
  try {
    storage.setItem(pageWallLastUsedStorageKey(pageTabId), JSON.stringify(normalized))
  } catch {
    // UI preference persistence must never block Page Wall.
  }
}
