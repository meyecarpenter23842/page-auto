import type { FacebookPostTaskJobRequest } from '../../shared/facebookTasks'
import type { PostingJobResult } from '../../shared/posting'

/**
 * A posting browser belongs to the current automation turn. Login/session/checkpoint
 * failures must not leave a hidden retained Chrome behind after that turn ends; the
 * orchestrator will release the worker/browser and either rotate to the next account
 * or pause only after every account in the cycle is unavailable.
 *
 * Keep this compatibility helper so existing worker call sites stay explicit about
 * lifecycle ownership. Manual repair belongs to the operator profile/browser flow,
 * not to a failed posting worker.
 */
export function shouldRetainPostingBrowserForManualSession(_result: PostingJobResult): boolean {
  return false
}

/**
 * Browser release is owned by the explicit worker lifecycle contract, never by a
 * magic persisted run id. One-shot jobs own no account turn after completion, while
 * rotation jobs keep their reusable browser lifecycle under orchestration control.
 */
export function shouldAutoReleasePostingBrowserForOneShot(job: FacebookPostTaskJobRequest): boolean {
  return job.executionMode === 'one_shot'
}
