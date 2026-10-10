import type { AccountStatus } from '../../../shared/accounts'

export type CheckLiveSummaryBucket = 'live' | 'problem' | 'unknown'

export function checkLiveSummaryBucket(status: AccountStatus | undefined): CheckLiveSummaryBucket {
  if (status === 'valid') return 'live'
  if (status === undefined || status === 'unknown') return 'unknown'
  return 'problem'
}
