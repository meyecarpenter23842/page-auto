import { describe, expect, it, vi } from 'vitest'
import { CanonicalEmailCodeProvider, type CanonicalEmailCodeState } from './canonicalEmailCodeProvider'

function baseState(token = 'cipher-a'): CanonicalEmailCodeState {
  return {
    oauthStatus: 'valid',
    oauthClientId: 'public-client-id',
    refreshTokenCiphertext: token,
    lastCodeAt: null
  }
}

describe('CanonicalEmailCodeProvider', () => {
  it('returns a typed missing-auth result without reading mail when canonical OAuth is absent', async () => {
    const readMessages = vi.fn()
    const provider = new CanonicalEmailCodeProvider({
      getAccount: () => ({ email: 'owner@example.com' }),
      getState: () => null,
      readMessages,
      updateState: vi.fn()
    })

    const result = await provider.getEmailCode({ accountId: 7, consumer: 'manual', timeoutMs: 0 })
    expect(result.status).toBe('email_auth_missing')
    expect(result.code).toBeNull()
    expect(readMessages).not.toHaveBeenCalled()
  })

  it('uses the latest canonical state on every request instead of caching a refresh token', async () => {
    let token = 'cipher-a'
    const seenTokens: string[] = []
    const provider = new CanonicalEmailCodeProvider({
      getAccount: () => ({ email: 'owner@example.com' }),
      getState: () => baseState(token),
      readMessages: async (_accountId, state) => {
        seenTokens.push(state.refreshTokenCiphertext ?? '')
        return [{
          id: `mail-${seenTokens.length}`,
          receivedAt: Date.now(),
          sender: 'security@example.com',
          subject: 'Your verification code',
          bodyPreview: 'Use 654321 to verify your account.',
          bodyText: ''
        }]
      },
      updateState: vi.fn()
    })

    expect((await provider.getEmailCode({ accountId: 1, consumer: 'manual' })).status).toBe('success')
    token = 'cipher-b'
    expect((await provider.getEmailCode({ accountId: 1, consumer: 'manual' })).status).toBe('success')
    expect(seenTokens).toEqual(['cipher-a', 'cipher-b'])
  })

  it('requires a fresh Facebook-context mail for the Facebook consumer', async () => {
    const now = Date.UTC(2026, 7, 26, 12, 0, 0)
    const provider = new CanonicalEmailCodeProvider({
      getAccount: () => ({ email: 'owner@example.com' }),
      getState: () => baseState(),
      readMessages: async () => [
        { id: 'unrelated', receivedAt: now - 5_000, sender: 'security@microsoft.com', subject: 'Verification code', bodyPreview: 'Use 111111 for Facebook.', bodyText: '' },
        { id: 'stale-facebook', receivedAt: now - 5 * 60_000, sender: 'security@facebookmail.com', subject: 'Facebook login code', bodyPreview: 'Code 333333', bodyText: '' },
        { id: 'fresh-facebook', receivedAt: now - 10_000, sender: 'security@facebookmail.com', subject: 'Facebook security code', bodyPreview: 'Use 222222 to verify.', bodyText: '' }
      ],
      updateState: vi.fn(),
      now: () => now
    })

    const result = await provider.getEmailCode({
      accountId: 9,
      consumer: 'facebook_login',
      notBefore: now - 60_000,
      timeoutMs: 0
    })
    expect(result.status).toBe('success')
    expect(result.code).toBe('222222')
  })

  it('maps invalid OAuth grants to email_auth_expired without exposing token content', async () => {
    const updateState = vi.fn()
    const provider = new CanonicalEmailCodeProvider({
      getAccount: () => ({ email: 'owner@example.com' }),
      getState: () => baseState('cipher-secret'),
      readMessages: async () => { throw new Error('Microsoft OAuth invalid_grant.') },
      updateState
    })

    const result = await provider.getEmailCode({ accountId: 3, consumer: 'manual' })
    expect(result.status).toBe('email_auth_expired')
    expect(result.message).not.toContain('cipher-secret')
    expect(JSON.stringify(updateState.mock.calls)).not.toContain('cipher-secret')
  })

  it('polls only inside the bounded Facebook window and returns a newly arrived code', async () => {
    let now = 1_000_000
    let reads = 0
    const provider = new CanonicalEmailCodeProvider({
      getAccount: () => ({ email: 'owner@example.com' }),
      getState: () => baseState(),
      readMessages: async () => {
        reads += 1
        return reads === 1 ? [] : [{
          id: 'facebook-new',
          receivedAt: now,
          sender: 'security@facebookmail.com',
          subject: 'Facebook verification code',
          bodyPreview: 'Use 778899 to continue.',
          bodyText: ''
        }]
      },
      updateState: vi.fn(),
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds }
    })

    const result = await provider.getEmailCode({
      accountId: 4,
      consumer: 'facebook_login',
      notBefore: now - 1_000,
      timeoutMs: 3_000
    })
    expect(result.status).toBe('success')
    expect(result.code).toBe('778899')
    expect(reads).toBe(2)
  })
})
