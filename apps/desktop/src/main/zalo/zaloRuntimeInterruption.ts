import {
  zaloActionResult,
  type ZaloActionInput,
  type ZaloActionResult
} from '../../shared/zalo'

export type ZaloRuntimeInterruptionReason = 'operator_close' | 'runtime_shutdown' | 'worker_crash'

/**
 * Keep operator/runtime shutdown distinct from an unexpected worker crash.
 * A crash must be a failed action so batch orchestration can apply its failure
 * policy and, when allowed, let the next action reopen the persistent profile.
 */
export function interruptedZaloActionResult(
  accountId: number,
  action: ZaloActionInput,
  reason: ZaloRuntimeInterruptionReason,
  message: string
): ZaloActionResult {
  if (reason === 'worker_crash') {
    return zaloActionResult(
      accountId,
      action.type,
      action.targetPhone,
      'failed',
      'executor_exception',
      message
    )
  }

  return zaloActionResult(
    accountId,
    action.type,
    action.targetPhone,
    'stopped',
    'stopped',
    message
  )
}
