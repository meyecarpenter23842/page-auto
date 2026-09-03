export const FACEBOOK_SESSION_POLICY_STATES = ['VALID', 'LOGGED_OUT', 'CHECKPOINT'] as const
export type FacebookSessionPolicyState = typeof FACEBOOK_SESSION_POLICY_STATES[number]

export const FACEBOOK_LOGIN_RECOVERY_ORDER = ['COOKIE', 'IDENTIFIER_PASSWORD', 'TWO_FACTOR'] as const
export type FacebookLoginRecoveryStep = typeof FACEBOOK_LOGIN_RECOVERY_ORDER[number]

export type FacebookSessionPolicyReason =
  | 'valid'
  | 'login_required'
  | 'checkpoint'
  | 'two_factor_missing'
  | 'two_factor_failed'
  | 'login_failed'
  | 'unknown'

export type FacebookRuntimeSessionState = 'valid' | 'needs_login' | 'verification_required'

/**
 * Top-level business policy only. Detailed checkpoint/2FA/login statuses remain
 * typed separately for Account Manager and diagnostics.
 */
export function facebookSessionPolicyStateFromReason(
  reason: FacebookSessionPolicyReason
): FacebookSessionPolicyState {
  if (reason === 'valid') return 'VALID'
  if (reason === 'checkpoint') return 'CHECKPOINT'
  return 'LOGGED_OUT'
}

export function facebookSessionPolicyStateFromRuntimeState(
  state: FacebookRuntimeSessionState
): FacebookSessionPolicyState {
  if (state === 'valid') return 'VALID'
  if (state === 'verification_required') return 'CHECKPOINT'
  return 'LOGGED_OUT'
}

export function facebookSessionPolicyAllowsAutoLogin(state: FacebookSessionPolicyState): boolean {
  return state === 'LOGGED_OUT'
}

export function facebookSessionPolicyStopsFacebookActions(state: FacebookSessionPolicyState): boolean {
  return state === 'CHECKPOINT'
}
