import type { FacebookPostTaskJobRequest } from '../../shared/facebookTasks'
import type { PostingJobResult } from '../../shared/posting'

/**
 * Manual session/checkpoint states own the live persistent browser until the operator
 * has a chance to repair the session. Checkpoint 282/956 are explicit terminal
 * account-turn states: RotationService may release the worker/browser and continue
 * after the configured account-switch delay.
 */
export function shouldRetainPostingBrowserForManualSession(result: PostingJobResult): boolean {
  const validation = result.sessionValidation
  const state = validation?.state
  const checkpointKind = validation?.checkpointKind
  const terminalCheckpoint = state === 'verification_required'
    && (checkpointKind === '282' || checkpointKind === '956')
  if (terminalCheckpoint) return false

  return result.code === 'needs_login'
    || result.code === 'verification_required'
    || result.status === 'needs_login'
    || state === 'needs_login'
    || state === 'verification_required'
}

/**
 * Manual Page Wall "Đăng ngay" uses runId=0 as a one-shot task sentinel.
 * It owns no account turn after the result, so its posting worker/browser must be
 * released before the result is returned to Main. Scheduled/rotation tasks keep the
 * reusable account-turn lifecycle owned by orchestration.
 */
export function shouldAutoReleasePostingBrowserForOneShot(job: FacebookPostTaskJobRequest): boolean {
  return job.runId === 0 && job.task.type === 'page_wall_post'
}
