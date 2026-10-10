import { describe, expect, it } from 'vitest'
import {
  accountStatusFromCheckpointKind,
  accountStatusFromFacebookChallenge,
  accountStatusFromFacebookSessionReason,
  isFacebookAccountProblemStatus
} from './facebookAccountState'

describe('canonical Facebook account state', () => {
  it('keeps login and 2FA failures distinct instead of collapsing to needs_login', () => {
    expect(accountStatusFromFacebookSessionReason('login_required')).toBe('needs_login')
    expect(accountStatusFromFacebookSessionReason('login_failed')).toBe('login_failed')
    expect(accountStatusFromFacebookSessionReason('two_factor_missing')).toBe('two_factor_required')
    expect(accountStatusFromFacebookSessionReason('two_factor_failed')).toBe('two_factor_failed')
    expect(accountStatusFromFacebookSessionReason('unknown')).toBe('needs_attention')
  })

  it('maps checkpoint kinds without mutating the source checkpoint semantics', () => {
    expect(accountStatusFromCheckpointKind('282')).toBe('checkpoint_282')
    expect(accountStatusFromCheckpointKind('956')).toBe('checkpoint_956')
    expect(accountStatusFromCheckpointKind('956_purple_lock')).toBe('locked')
    expect(accountStatusFromCheckpointKind('disabled')).toBe('disabled')
    expect(accountStatusFromCheckpointKind('unknown')).toBe('checkpoint_unknown')
  })

  it('maps semantic challenges to actionable account states', () => {
    expect(accountStatusFromFacebookChallenge('email_code_challenge')).toBe('email_code_required')
    expect(accountStatusFromFacebookChallenge('totp_2fa_challenge')).toBe('two_factor_required')
    expect(accountStatusFromFacebookChallenge('identity_verification_required')).toBe('identity_verification_required')
    expect(accountStatusFromFacebookChallenge('security_review_required')).toBe('security_review_required')
    expect(accountStatusFromFacebookChallenge('account_locked', '956_purple_lock')).toBe('locked')
    expect(accountStatusFromFacebookChallenge('account_disabled', 'disabled')).toBe('disabled')
    expect(accountStatusFromFacebookChallenge('unsupported_checkpoint', '282')).toBe('checkpoint_282')
    expect(accountStatusFromFacebookChallenge('unsupported_checkpoint', '956')).toBe('checkpoint_956')
    expect(accountStatusFromFacebookChallenge('unsupported_checkpoint', 'unknown')).toBe('checkpoint_unknown')
  })

  it('uses only valid/unknown as non-problem display tones', () => {
    expect(isFacebookAccountProblemStatus('valid')).toBe(false)
    expect(isFacebookAccountProblemStatus('unknown')).toBe(false)
    expect(isFacebookAccountProblemStatus('needs_login')).toBe(true)
    expect(isFacebookAccountProblemStatus('disabled')).toBe(true)
  })
})
