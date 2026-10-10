import type { Page } from 'playwright-core'
import type { AccountStatus } from '../../shared/accounts'
import { accountStatusFromFacebookSessionReason } from '../../shared/facebookAccountState'
import type { FacebookSessionResult } from './facebookSession'
import { detectFacebookAccountStatus } from './posting/facebookCheckpoint'

type CheckpointStatusDetector = (page: Page) => Promise<AccountStatus>

/**
 * Resolve the master Account status from a Check Live session result.
 *
 * Session Common still carries a coarse cookie/session state, while the live
 * checkpoint classifier can identify disabled/locked/identity/CP282/CP956.
 * Check Live must persist that canonical account state instead of collapsing
 * every non-valid outcome to `needs_login`.
 */
export async function resolveCheckLiveAccountStatus(
  page: Page,
  session: FacebookSessionResult,
  detectCheckpointStatus: CheckpointStatusDetector = detectFacebookAccountStatus
): Promise<AccountStatus> {
  if (session.status === 'valid' || session.reason === 'valid') return 'valid'

  if (session.reason !== 'checkpoint') {
    return accountStatusFromFacebookSessionReason(session.reason)
  }

  const detected = await detectCheckpointStatus(page).catch(() => 'checkpoint_unknown' as const)
  // A checkpoint can disappear between Session Common and the classifier. Do
  // not turn that race into a false green Check Live result.
  if (detected === 'valid' || detected === 'unknown') return 'checkpoint_unknown'
  return detected
}
