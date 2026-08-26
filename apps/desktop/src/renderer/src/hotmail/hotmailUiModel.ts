import type { HotmailDashboardRow } from '../../../shared/hotmail'

export type EmailQuickFilter = 'all' | 'ready' | 'needs_attention' | 'oauth_missing' | 'recovery'

export function filterHotmailRows(
  rows: HotmailDashboardRow[],
  query: string,
  filter: EmailQuickFilter
): HotmailDashboardRow[] {
  const normalizedQuery = query.trim().toLowerCase()

  return rows.filter((row) => {
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

    if (!matchesFilter || !normalizedQuery) return matchesFilter

    return [
      row.uid,
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
