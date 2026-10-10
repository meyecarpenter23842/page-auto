import type { AccountStatus } from '../../shared/accounts'
import type { FacebookSessionResult } from './facebookSession'

/**
 * Persist Facebook account-state evidence from Check Live without allowing a
 * technical browser/worker failure to erase the last known Facebook status.
 */
export function persistedCheckLiveAccountStatus(
  currentStatus: AccountStatus,
  session: Pick<FacebookSessionResult, 'status' | 'cookieStatus'>
): AccountStatus {
  if (session.status === 'unknown' && session.cookieStatus === 'error') return currentStatus
  return session.status
}
