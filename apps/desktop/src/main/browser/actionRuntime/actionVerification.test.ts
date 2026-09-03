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

  it('returns uncertain without revisiting when visual stabilization fails', async () => {
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

    expect(result).toEqual({ status: 'uncertain', phase: 'revisit', reason: 'stabilize_failed' })
    expect(revisits).toBe(0)
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
