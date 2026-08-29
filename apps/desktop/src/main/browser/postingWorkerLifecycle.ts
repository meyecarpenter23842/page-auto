import type { FacebookPostTaskJobRequest } from '../../shared/facebookTasks'
import type { PostingJobResult } from '../../shared/posting'

/**
 * Manual session/checkpoint states own the live persistent browser until the operator
 * has a chance to repair the session. Checkpoint 282/956/disabled are explicit terminal
 * account-turn states: RotationService may release the worker/browser and continue
 * after the configured account-switch delay.
 */
export function shouldRetainPostingBrowserForManualSession(result: PostingJobResult): boolean {
  const validation = result.sessionValidation
  const state = validation?.state
  const checkpointKind = validation?.checkpointKind
  const terminalCheckpoint = state === 'verification_required'
    && (checkpointKind === '282' || checkpointKind === '956' || checkpointKind === 'disabled')
  if (terminalCheckpoint) return false

  return result.code === 'needs_login'
    || result.code === 'verification_required'
    || result.status === 'needs_login'
    || state === 'needs_login'
    || state === 'verification_required'
}

/**
 * Browser release is owned by the explicit worker lifecycle contract, never by a
 * magic persisted run id. One-shot jobs own no account turn after completion, while
 * rotation jobs keep their reusable browser lifecycle under orchestration control.
 */
export function shouldAutoReleasePostingBrowserForOneShot(job: FacebookPostTaskJobRequest): boolean {
  return job.executionMode === 'one_shot'
}
