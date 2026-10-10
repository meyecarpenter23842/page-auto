import type { SessionSettings } from '../../shared/appSettings'
import type { PostingJobResult } from '../../shared/posting'

export type SessionFailureKind = 'session_expired' | 'checkpoint'
export type SessionFailureAction = 'continue' | 'stop'

export interface SessionFailureDecision {
  kind: SessionFailureKind
  action: SessionFailureAction
}

/**
 * Login/session/checkpoint failures belong to the current account turn, not to the
 * whole Page Tab. RotationService releases that account, waits the configured
 * account-switch delay and moves on. The tab itself only pauses after its normal
 * unavailable-account guard proves that the whole current cycle has no usable account.
 *
 * Keep the settings parameter for API compatibility with the existing orchestrator.
 * Legacy onSessionExpired/onCheckpoint "stop" values no longer override this invariant.
 */
export function resolveSessionFailureDecision(
  result: PostingJobResult,
  _settings: SessionSettings
): SessionFailureDecision | null {
  const state = result.sessionValidation?.state
  const checkpoint = result.code === 'verification_required' || state === 'verification_required'
  if (checkpoint) return { kind: 'checkpoint', action: 'continue' }

  const expired = result.code === 'needs_login' || result.status === 'needs_login' || state === 'needs_login'
  if (!expired) return null
  return { kind: 'session_expired', action: 'continue' }
}
