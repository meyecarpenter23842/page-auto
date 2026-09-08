import { describe, expect, it } from 'vitest'
import { runMicrosoftAuthDispatchLoop } from './microsoftAuthDispatcher'
import type { EmailAuthV2Surface } from './emailAuthV2Contracts'

describe('runMicrosoftAuthDispatchLoop', () => {
  it('re-detects after every handled state instead of assuming a linear next step', async () => {
    const states: EmailAuthV2Surface[] = ['recovery_code', 'username', 'password', 'authenticated']
    let detectCalls = 0
    const handled: EmailAuthV2Surface[] = []

    const result = await runMicrosoftAuthDispatchLoop({
      detect: async () => {
        const surface = states[detectCalls]
        detectCalls += 1
        return surface ? { surface, detection: surface } : null
      },
      handlers: {
        recovery_code: async ({ surface }) => {
          handled.push(surface)
          return { kind: 'handled' }
        },
        username: async ({ surface }) => {
          handled.push(surface)
          return { kind: 'handled' }
        },
        password: async ({ surface }) => {
          handled.push(surface)
          return { kind: 'handled' }
        },
        authenticated: async ({ surface }) => {
          handled.push(surface)
          return { kind: 'authenticated' }
        }
      }
    })

    expect(result).toEqual({ kind: 'authenticated' })
    expect(handled).toEqual(states)
    expect(detectCalls).toBe(4)
  })

  it('re-detects after retryable outcomes', async () => {
    let detectCalls = 0
    const result = await runMicrosoftAuthDispatchLoop({
      detect: async () => {
        detectCalls += 1
        return detectCalls === 1
          ? { surface: 'login_transition', detection: 'loading' }
          : { surface: 'authenticated', detection: 'ready' }
      },
      handlers: {
        login_transition: async () => ({ kind: 'retryable', reason: 'settling' }),
        authenticated: async () => ({ kind: 'authenticated' })
      }
    })

    expect(result).toEqual({ kind: 'authenticated' })
    expect(detectCalls).toBe(2)
  })

  it('fails closed when a detected surface has no audited handler', async () => {
    const result = await runMicrosoftAuthDispatchLoop({
      detect: async () => ({ surface: 'passkey_prompt', detection: 'live-unverified' }),
      handlers: {}
    })

    expect(result).toEqual({
      kind: 'needs_attention',
      reason: 'unsupported_microsoft_surface:passkey_prompt'
    })
  })

  it('bounds repeated transitions so the controller cannot loop forever', async () => {
    let detectCalls = 0
    const result = await runMicrosoftAuthDispatchLoop({
      maxSteps: 3,
      detect: async () => {
        detectCalls += 1
        return { surface: 'login_transition', detection: detectCalls }
      },
      handlers: {
        login_transition: async () => ({ kind: 'retryable', reason: 'still-loading' })
      }
    })

    expect(result).toEqual({
      kind: 'needs_attention',
      reason: 'microsoft_auth_retry_budget_exhausted'
    })
    expect(detectCalls).toBe(3)
  })
})
