import type { AccountStatus } from './accounts'
import type { FacebookCommonChallengeType } from './facebookCheckpoint'
import type { PostingCheckpointKind } from './posting'

export type FacebookSessionReasonLike =
  | 'valid'
  | 'login_required'
  | 'checkpoint'
  | 'two_factor_missing'
  | 'two_factor_failed'
  | 'login_failed'
  | 'identity_mismatch'
  | 'unknown'

export function accountStatusFromCheckpointKind(kind: PostingCheckpointKind | null | undefined): AccountStatus {
  switch (kind) {
    case '282': return 'checkpoint_282'
    case '956': return 'checkpoint_956'
    case '956_purple_lock': return 'locked'
    case 'disabled': return 'disabled'
    case 'unknown': return 'checkpoint_unknown'
    default: return 'checkpoint_unknown'
  }
}

export function accountStatusFromFacebookChallenge(
  type: FacebookCommonChallengeType,
  checkpointKind?: PostingCheckpointKind | null
): AccountStatus {
  switch (type) {
    case 'checkpoint_cleared': return 'valid'
    case 'email_code_challenge': return 'email_code_required'
    case 'totp_2fa_challenge': return 'two_factor_required'
    case 'login_reauth': return 'needs_login'
    case 'identity_verification_required': return 'identity_verification_required'
    case 'security_review_required': return 'security_review_required'
    case 'account_locked': return 'locked'
    case 'account_disabled': return 'disabled'
    case 'unsupported_checkpoint': return accountStatusFromCheckpointKind(checkpointKind)
  }
}

export function accountStatusFromFacebookSessionReason(reason: FacebookSessionReasonLike): AccountStatus {
  switch (reason) {
    case 'valid': return 'valid'
    case 'login_required': return 'needs_login'
    case 'login_failed': return 'login_failed'
    case 'two_factor_missing': return 'two_factor_required'
    case 'two_factor_failed': return 'two_factor_failed'
    case 'checkpoint': return 'checkpoint_unknown'
    case 'identity_mismatch': return 'needs_attention'
    case 'unknown': return 'needs_attention'
  }
}

export function isFacebookAccountProblemStatus(status: AccountStatus): boolean {
  return status !== 'valid' && status !== 'unknown'
}
