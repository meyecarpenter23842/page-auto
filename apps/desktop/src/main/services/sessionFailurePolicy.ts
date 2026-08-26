import type { SessionSettings } from '../../shared/appSettings'
import type { PostingJobResult } from '../../shared/posting'

export type SessionFailureKind = 'session_expired' | 'checkpoint'
export type SessionFailureAction = 'continue' | 'stop'

export interface SessionFailureDecision {
  kind: SessionFailureKind
  action: SessionFailureAction
}

function isUnresolvedPreflightSession(result: PostingJobResult): boolean {
  return result.status === 'needs_login'
    && result.sessionValidation?.phase === 'before_run'
    && result.sessionValidation.state === 'needs_login'
}

function isKnownTerminalCheckpoint(result: PostingJobResult): boolean {
  const kind = result.sessionValidation?.checkpointKind
  return kind === '282' || kind === '956'
}

export function resolveSessionFailureDecision(
  result: PostingJobResult,
  settings: SessionSettings
): SessionFailureDecision | null {
  const state = result.sessionValidation?.state
  const checkpoint = result.code === 'verification_required' || state === 'verification_required'
  if (checkpoint) {
    // 282/956 are explicitly classified terminal account-turn states. We do not
    // attempt to solve/bypass them: the current browser can be released, then the
    // normal account-switch delay runs before the next account starts.
    if (isKnownTerminalCheckpoint(result)) {
      return { kind: 'checkpoint', action: 'continue' }
    }

    // An unidentified checkpoint remains manual. Never rotate just because the old
    // onCheckpoint setting says "continue"; otherwise unresolved Chrome sessions
    // can accumulate while the scheduler opens more accounts.
    return { kind: 'checkpoint', action: 'stop' }
  }

  // PostingEngine đã thử cookie/saved profile/password/2FA trước khi trả before_run needs_login.
  // Worker giữ browser để sửa session thủ công, nên Page Tab phải đứng tại account hiện tại;
  // nếu tiếp tục account kế tiếp sẽ có nhiều browser unresolved cùng lúc.
  if (isUnresolvedPreflightSession(result)) {
    return { kind: 'session_expired', action: 'stop' }
  }

  const expired = result.code === 'needs_login' || result.status === 'needs_login' || state === 'needs_login'
  if (!expired) return null
  return {
    kind: 'session_expired',
    action: settings.onSessionExpired === 'needs_login_stop' ? 'stop' : 'continue'
  }
}
