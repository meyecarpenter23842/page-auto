import type { HotmailDashboardRow } from '../../../shared/hotmail'

export type EmailQuickFilter = 'all' | 'ready' | 'needs_attention' | 'oauth_missing' | 'recovery'
export const EMAIL_CATEGORY_ALL = '__all__'
export const EMAIL_CATEGORY_UNGROUPED = '__ungrouped__'
export type EmailCategoryFilter = typeof EMAIL_CATEGORY_ALL | typeof EMAIL_CATEGORY_UNGROUPED | string

export interface EmailCategoryOption {
  value: string
  label: string
  count: number
}

function normalizedCategory(value: string | null): string {
  return value?.trim() ?? ''
}

export function listHotmailCategoryOptions(rows: HotmailDashboardRow[]): EmailCategoryOption[] {
  const counts = new Map<string, number>()
  let ungrouped = 0

  for (const row of rows) {
    const category = normalizedCategory(row.accountCategory)
    if (!category) {
      ungrouped += 1
      continue
    }
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }

  const options = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'vi', { numeric: true, sensitivity: 'base' }))
    .map(([value, count]) => ({ value, label: value, count }))

  return ungrouped > 0
    ? [{ value: EMAIL_CATEGORY_UNGROUPED, label: 'Chưa gán nhóm', count: ungrouped }, ...options]
    : options
}

export function filterHotmailRows(
  rows: HotmailDashboardRow[],
  query: string,
  filter: EmailQuickFilter,
  categoryFilter: EmailCategoryFilter = EMAIL_CATEGORY_ALL
): HotmailDashboardRow[] {
  const normalizedQuery = query.trim().toLowerCase()

  return rows.filter((row) => {
    const category = normalizedCategory(row.accountCategory)
    const matchesCategory = categoryFilter === EMAIL_CATEGORY_ALL
      || (categoryFilter === EMAIL_CATEGORY_UNGROUPED ? !category : category === categoryFilter)

    const matchesFilter = (() => {
      if (filter === 'ready') return row.oauthStatus === 'valid' && row.hasRefreshToken && row.mailStatus === 'ready'
      if (filter === 'needs_attention') {
        return Boolean(row.lastError)
          || row.oauthStatus === 'expired'
          || row.oauthStatus === 'error'
          || row.mailStatus === 'needs_login'
          || row.mailStatus === 'error'
          || row.profileStatus === 'in_use'
      }
      if (filter === 'oauth_missing') return !row.hasRefreshToken || row.oauthStatus === 'missing'
      if (filter === 'recovery') return Boolean(row.backupEmail)
      return true
    })()

    if (!matchesCategory || !matchesFilter || !normalizedQuery) return matchesCategory && matchesFilter

    return [
      row.uid,
      row.accountName,
      row.accountCategory,
      row.facebookStatus,
      row.accountNote,
      row.email,
      row.backupEmail,
      row.oauthClientId,
      row.profileDirectory,
      row.lastError
    ].some((value) => value?.toLowerCase().includes(normalizedQuery))
  })
}

export function previewClientId(value: string | null): string {
  if (!value) return '—'
  if (value.length <= 14) return value
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}
