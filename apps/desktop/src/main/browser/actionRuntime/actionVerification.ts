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

/**
 * Common contract for consequential Facebook actions:
 *
 * 1. trust an immediate target-scoped verification when it is conclusive;
 * 2. otherwise stabilize the shared visual/layout boundary;
 * 3. revisit the exact target without repeating the consequential action;
 * 4. verify the resulting state once more;
 * 5. return `uncertain` instead of blindly retrying the original action.
 *
 * Business modules provide target navigation and target-state readers; this common
 * helper owns the fallback semantics and is intentionally selector-free.
 */
export async function verifyActionWithTargetRevisit<T>(input: {
  immediate: T | null
  stabilize?: () => Promise<boolean>
  revisit: () => Promise<boolean>
  verifyAfterRevisit: () => Promise<T | null>
}): Promise<ActionVerificationResult<T>> {
  if (input.immediate !== null) {
    return { status: 'verified', phase: 'immediate', value: input.immediate }
  }

  if (input.stabilize && !await input.stabilize()) {
    return { status: 'uncertain', phase: 'revisit', reason: 'stabilize_failed' }
  }

  if (!await input.revisit()) {
    return { status: 'uncertain', phase: 'revisit', reason: 'revisit_failed' }
  }

  const verified = await input.verifyAfterRevisit()
  if (verified === null) {
    return { status: 'uncertain', phase: 'revisit', reason: 'state_unconfirmed' }
  }

  return { status: 'verified', phase: 'revisit', value: verified }
}
