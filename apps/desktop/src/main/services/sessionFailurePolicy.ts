import type { SessionSettings } from '../../shared/appSettings'
import type { PostingJobResult } from '../../shared/posting'

export type SessionFailureKind = 'session_expired' | 'checkpoint'
export type SessionFailureAction = 'continue' | 'stop'

export interface SessionFailureDecision {
  kind: SessionFailureKind
  action: SessionFailureAction
}

export function resolveSessionFailureDecision(
  result: PostingJobResult,
  settings: SessionSettings
): SessionFailureDecision | null {
  const state = result.sessionValidation?.state
  const checkpoint = result.code === 'verification_required' || state === 'verification_required'
  if (checkpoint) {
    return {
      kind: 'checkpoint',
      action: settings.onCheckpoint === 'needs_login_stop' ? 'stop' : 'continue'
    }
  }

  const expired = result.code === 'needs_login' || result.status === 'needs_login' || state === 'needs_login'
  if (!expired) return null
  return {
    kind: 'session_expired',
    action: settings.onSessionExpired === 'needs_login_stop' ? 'stop' : 'continue'
  }
}