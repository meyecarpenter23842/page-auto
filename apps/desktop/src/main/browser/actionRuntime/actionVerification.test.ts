import { describe, expect, it } from 'vitest'
import { verifyActionWithTargetRevisit } from './actionVerification'

describe('action verification fallback contract', () => {
  it('accepts an immediate target-scoped result without revisit', async () => {
    let revisits = 0
    const result = await verifyActionWithTargetRevisit({
      immediate: 'joined',
      revisit: async () => {
        revisits += 1
        return true
      },
      verifyAfterRevisit: async () => 'joined'
    })

    expect(result).toEqual({ status: 'verified', phase: 'immediate', value: 'joined' })
    expect(revisits).toBe(0)
  })

  it('stabilizes, revisits the exact target and accepts the verified fallback state', async () => {
    const steps: string[] = []
    const result = await verifyActionWithTargetRevisit({
      immediate: null,
      stabilize: async () => {
        steps.push('stabilize')
        return true
      },
      revisit: async () => {
        steps.push('revisit')
        return true
      },
      verifyAfterRevisit: async () => {
        steps.push('verify')
        return 'requested'
      }
    })

    expect(result).toEqual({ status: 'verified', phase: 'revisit', value: 'requested' })
    expect(steps).toEqual(['stabilize', 'revisit', 'verify'])
  })

  it('still performs the safe exact-target revisit when visual stabilization fails', async () => {
    let revisits = 0
    const result = await verifyActionWithTargetRevisit({
      immediate: null,
      stabilize: async () => false,
      revisit: async () => {
        revisits += 1
        return true
      },
      verifyAfterRevisit: async () => 'joined'
    })

    expect(result).toEqual({ status: 'verified', phase: 'revisit', value: 'joined' })
    expect(revisits).toBe(1)
  })

  it('polls a bounded hydration window after revisit before declaring the state uncertain', async () => {
    let reads = 0
    let waits = 0
    const result = await verifyActionWithTargetRevisit({
      immediate: null,
      revisit: async () => true,
      verifyAfterRevisit: async () => {
        reads += 1
        return reads >= 3 ? 'joined' : null
      },
      polling: {
        timeoutMs: 2_000,
        intervalMs: 100,
        wait: async () => {
          waits += 1
          return true
        }
      }
    })

    expect(result).toEqual({ status: 'verified', phase: 'revisit', value: 'joined' })
    expect(reads).toBe(3)
    expect(waits).toBe(2)
  })

  it('returns stabilize_failed only after the safe revisit still cannot confirm state', async () => {
    const result = await verifyActionWithTargetRevisit({
      immediate: null,
      stabilize: async () => false,
      revisit: async () => true,
      verifyAfterRevisit: async () => null
    })

    expect(result).toEqual({ status: 'uncertain', phase: 'revisit', reason: 'stabilize_failed' })
  })

  it('returns uncertain when exact-target revisit still cannot confirm state', async () => {
    const result = await verifyActionWithTargetRevisit({
      immediate: null,
      revisit: async () => true,
      verifyAfterRevisit: async () => null
    })

    expect(result).toEqual({ status: 'uncertain', phase: 'revisit', reason: 'state_unconfirmed' })
  })
})
