export type ActionVerificationPhase = 'immediate' | 'revisit'
export type ActionVerificationUncertainReason = 'stabilize_failed' | 'revisit_failed' | 'state_unconfirmed'

export type ActionVerificationResult<T> =
  | {
      status: 'verified'
      phase: ActionVerificationPhase
      value: T
    }
  | {
      status: 'uncertain'
      phase: 'revisit'
      reason: ActionVerificationUncertainReason
    }

export interface ActionVerificationPolling {
  timeoutMs: number
  intervalMs: number
  wait?: (delayMs: number) => Promise<boolean | void>
}

async function waitForVerificationPoll(
  polling: ActionVerificationPolling,
  delayMs: number
): Promise<boolean> {
  if (delayMs <= 0) return true
  if (polling.wait) return await polling.wait(delayMs) !== false
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
  return true
}

async function pollVerifiedState<T>(
  verify: () => Promise<T | null>,
  polling: ActionVerificationPolling | undefined
): Promise<T | null> {
  const first = await verify()
  if (first !== null || !polling || polling.timeoutMs <= 0) return first

  const timeoutMs = Math.max(0, Math.floor(polling.timeoutMs))
  const intervalMs = Math.max(50, Math.floor(polling.intervalMs))
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()
    if (!await waitForVerificationPoll(polling, Math.min(intervalMs, remaining))) return null
    const state = await verify()
    if (state !== null) return state
  }
  return null
}

/**
 * Common contract for consequential Facebook actions:
 *
 * 1. trust an immediate target-scoped verification when it is conclusive;
 * 2. otherwise ask the shared visual/layout boundary to stabilize;
 * 3. revisit the exact target without repeating the consequential action;
 * 4. poll the target state for a bounded hydration window when configured;
 * 5. return `uncertain` instead of blindly retrying the original action.
 *
 * A visual recovery failure does not block an exact-target read-only revisit. Facebook may have
 * already completed the action, and safe navigation + state verification is strictly safer than
 * declaring failure before checking the target again. Business modules still must not repeat the
 * consequential click when this helper returns `uncertain`.
 */
export async function verifyActionWithTargetRevisit<T>(input: {
  immediate: T | null
  stabilize?: () => Promise<boolean>
  revisit: () => Promise<boolean>
  verifyAfterRevisit: () => Promise<T | null>
  polling?: ActionVerificationPolling
}): Promise<ActionVerificationResult<T>> {
  if (input.immediate !== null) {
    return { status: 'verified', phase: 'immediate', value: input.immediate }
  }

  const stabilized = input.stabilize ? await input.stabilize() : true

  if (!await input.revisit()) {
    return {
      status: 'uncertain',
      phase: 'revisit',
      reason: stabilized ? 'revisit_failed' : 'stabilize_failed'
    }
  }

  const verified = await pollVerifiedState(input.verifyAfterRevisit, input.polling)
  if (verified === null) {
    return {
      status: 'uncertain',
      phase: 'revisit',
      reason: stabilized ? 'state_unconfirmed' : 'stabilize_failed'
    }
  }

  return { status: 'verified', phase: 'revisit', value: verified }
}
