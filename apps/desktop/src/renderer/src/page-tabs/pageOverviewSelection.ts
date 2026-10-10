/** Renderer-only preference. Never store Page config, account data or secrets. */
export const OVERVIEW_SELECTED_PAGE_KEY = 'page-auto.ui.page-tabs.overview.selected-page-id.v1'

type SelectionStorage = Pick<Storage, 'getItem' | 'setItem'>

export function readOverviewSelectedPageId(storage?: Pick<SelectionStorage, 'getItem'> | null): number | null {
  try {
    const source = storage === undefined ? typeof window === 'undefined' ? null : window.localStorage : storage
    const saved = source?.getItem(OVERVIEW_SELECTED_PAGE_KEY)
    if (!saved || !/^[1-9]\d*$/.test(saved)) return null
    const id = Number(saved)
    return Number.isSafeInteger(id) ? id : null
  } catch {
    // UI preferences must not prevent the overview from opening.
    return null
  }
}

export function saveOverviewSelectedPageId(id: number, storage?: Pick<SelectionStorage, 'setItem'> | null): void {
  if (!Number.isSafeInteger(id) || id <= 0) return
  try {
    const target = storage === undefined ? typeof window === 'undefined' ? null : window.localStorage : storage
    target?.setItem(OVERVIEW_SELECTED_PAGE_KEY, String(id))
  } catch {
    // In-memory selection stays usable even when storage is blocked.
  }
}
