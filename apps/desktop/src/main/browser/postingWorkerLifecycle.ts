import type { PostingJobResult } from '../../shared/posting'

/**
 * Manual session/checkpoint states own the live persistent browser until the operator
 * has a chance to repair the session. Normal posting failures should still release it.
 */
export function shouldRetainPostingBrowserForManualSession(result: PostingJobResult): boolean {
  const state = result.sessionValidation?.state
  return result.code === 'needs_login'
    || result.code === 'verification_required'
    || result.status === 'needs_login'
    || state === 'needs_login'
    || state === 'verification_required'
}
