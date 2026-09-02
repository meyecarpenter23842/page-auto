import type {
  PageTabAccountInput,
  PageTabConfig,
  PageTabSaveInput
} from '../../../shared/pageTabs'

export interface SharedPagePatch {
  name?: string
  pageUid?: string
  accounts?: PageTabAccountInput[]
}

export function buildSharedPageSaveInput(config: PageTabConfig, patch: SharedPagePatch = {}): PageTabSaveInput {
  const sourceAccounts = patch.accounts ?? config.accounts
  return {
    name: patch.name ?? config.name,
    pageUid: patch.pageUid ?? config.pageUid,
    rotation: { ...config.rotation },
    accounts: sourceAccounts.map((item, index) => ({
      accountId: item.accountId,
      enabled: item.enabled,
      sortOrder: index,
      postsPerTurn: item.postsPerTurn
    })),
    schedules: config.schedules.map((item) => ({
      dayOfWeek: item.dayOfWeek,
      startMinute: item.startMinute,
      endMinute: item.endMinute,
      enabled: item.enabled,
      sortOrder: item.sortOrder
    })),
    groupUids: [...config.groupUids],
    groupOrderMode: config.groupOrderMode ?? 'sequential',
    contentMode: config.contentMode,
    contents: [...config.contents],
    image: { ...config.image }
  }
}

export function accountInputsForSelection(config: PageTabConfig, selectedIds: readonly number[]): PageTabAccountInput[] {
  const selected = new Set(selectedIds)
  const existing = new Map(config.accounts.map((item) => [item.accountId, item] as const))
  const orderedIds = [
    ...config.accounts.filter((item) => selected.has(item.accountId)).map((item) => item.accountId),
    ...selectedIds.filter((id) => selected.has(id) && !existing.has(id))
  ]
  const seen = new Set<number>()
  return orderedIds.filter((id) => {
    if (seen.has(id)) return false
    seen.add(id)
    return true
  }).map((accountId, sortOrder) => {
    const current = existing.get(accountId)
    return {
      accountId,
      enabled: current?.enabled ?? true,
      sortOrder,
      postsPerTurn: current?.postsPerTurn ?? null
    }
  })
}
