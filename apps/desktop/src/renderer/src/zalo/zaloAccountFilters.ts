import type { ZaloAccountView } from '../../../shared/zalo'

/** Presentation-only filter: never changes the account list or session bindings. */
export function filterZaloAccounts<T extends Pick<ZaloAccountView, 'phone' | 'displayName' | 'note' | 'sessionStatus'>>(
  accounts: readonly T[], query: string, status: string
): T[] {
  const search = query.trim().toLocaleLowerCase('vi')
  return accounts.filter((account) => {
    if (status === 'ready' && account.sessionStatus !== 'ready') return false
    if (status === 'attention' && !['login_required', 'needs_attention', 'browser_error', 'profile_error', 'qr_waiting'].includes(account.sessionStatus)) return false
    if (!['all', 'ready', 'attention'].includes(status) && account.sessionStatus !== status) return false
    return !search || [account.phone, account.displayName ?? '', account.note ?? ''].some((field) => field.toLocaleLowerCase('vi').includes(search))
  })
}

export function toggleVisibleZaloAccounts(current: readonly number[], visible: readonly number[], allSelected: boolean): number[] {
  const visibleSet = new Set(visible)
  if (allSelected) return current.filter((id) => !visibleSet.has(id))
  return [...new Set([...current, ...visible])]
}
