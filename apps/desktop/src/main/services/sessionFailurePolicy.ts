import type { SessionSettings } from '../../shared/appSettings'
import type { PostingJobResult } from '../../shared/posting'

export type SessionFailureKind = 'session_expired' | 'checkpoint'
export type SessionFailureAction = 'continue' | 'stop'

export interface SessionFailureDecision {
  kind: SessionFailureKind
  action: SessionFailureAction
}

function isUnresolvedTwoFactor(result: PostingJobResult): boolean {
  if (result.status !== 'needs_login') return false
  const text = `${result.message} ${result.sessionValidation?.message ?? ''}`
  return /\b2fa\b|two[- ]factor|authentication app|authenticator app|mã xác thực/i.test(text)
}

export function resolveSessionFailureDecision(
  result: PostingJobResult,
  settings: SessionSettings
): SessionFailureDecision | null {
  // 2FA vẫn thuộc lượt đăng nhập của account hiện tại. Nếu không hoàn tất được,
  // dừng Page Tab và giữ browser account đó thay vì mở account kế tiếp song song.
  if (isUnresolvedTwoFactor(result)) {
    return { kind: 'session_expired', action: 'stop' }
  }

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