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
  now?: () => number
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
  if (!polling || polling.timeoutMs <= 0) return verify()

  const timeoutMs = Math.max(0, Math.floor(polling.timeoutMs))
  const intervalMs = Math.max(50, Math.floor(polling.intervalMs))
  const now = polling.now ?? Date.now
  const deadline = now() + timeoutMs
  // Keep a count bound as a second safety rail. In production the wait consumes real time,
  // but test/control implementations may resolve early; they must never create a busy loop.
  const maxAdditionalPolls = Math.max(1, Math.ceil(timeoutMs / intervalMs))

  const first = await verify()
  if (first !== null || now() >= deadline) return first

  for (let poll = 0; poll < maxAdditionalPolls; poll += 1) {
    const remainingMs = deadline - now()
    if (remainingMs <= 0) return null

    if (!await waitForVerificationPoll(polling, Math.min(intervalMs, remainingMs))) return null
    if (now() >= deadline) return null

    const state = await verify()
    if (state !== null) return state
    if (now() >= deadline) return null
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
