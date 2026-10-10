import { describe, expect, it, vi } from 'vitest'
import type { MailProvider, MailProviderCodeRequest, MailProviderCodeResult, MailboxCodeRequest } from './mailProvider'
import { MailboxProviderRouter } from './mailboxProviderRouter'

function provider(id: MailProvider['id']): MailProvider {
  return {
    id,
    async getVerificationCode(request: MailProviderCodeRequest): Promise<MailProviderCodeResult> {
      return {
        providerId: id,
        mailbox: request.mailbox,
        status: 'message_not_found',
        code: null,
        sender: null,
        messageKey: null,
        message: 'test provider'
      }
    }
  }
}

function request(overrides: Partial<MailboxCodeRequest> = {}): MailboxCodeRequest {
  return {
    accountId: 42,
    mailbox: 'owner@fivermail.com',
    role: 'recovery',
    purpose: 'microsoft_security',
    challengeId: 'challenge-1',
    baselineMessageKeys: ['baseline-1'],
    consumedMessageKeys: ['used-1'],
    ...overrides
  }
}

describe('MailboxProviderRouter', () => {
  it('resolves one domain to one registered module and preserves account/challenge context', async () => {
    const inboxesResolve = vi.fn(async (value: MailboxCodeRequest) => provider('inboxes'))
    const fviaResolve = vi.fn(async () => provider('fvia_inboxes'))
    const router = new MailboxProviderRouter([
      { providerId: 'inboxes', resolve: inboxesResolve },
      { providerId: 'fvia_inboxes', resolve: fviaResolve }
    ])

    const result = await router.resolve(request({ mailbox: ' Owner@FIVERMAIL.COM ' }))

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.providerId).toBe('inboxes')
    expect(result.mailbox).toBe('owner@fivermail.com')
    expect(result.provider.id).toBe('inboxes')
    expect(result.request.accountId).toBe(42)
    expect(result.request.challengeId).toBe('challenge-1')
    expect(result.request.baselineMessageKeys).toEqual(['baseline-1'])
    expect(result.request.consumedMessageKeys).toEqual(['used-1'])
    expect(inboxesResolve).toHaveBeenCalledTimes(1)
    expect(fviaResolve).not.toHaveBeenCalled()
  })

  it('fails closed for unknown mailbox domains without touching any provider module', async () => {
    const inboxesResolve = vi.fn(async () => provider('inboxes'))
    const router = new MailboxProviderRouter([
      { providerId: 'inboxes', resolve: inboxesResolve }
    ])

    const result = await router.resolve(request({ mailbox: 'owner@custom.example' }))

    expect(result.status).toBe('unsupported_mailbox')
    expect(result.providerId).toBeNull()
    expect(inboxesResolve).not.toHaveBeenCalled()
  })

  it('recognizes Microsoft mailboxes but keeps them unavailable until E-MOD-5 registers a mailbox module', async () => {
    const router = new MailboxProviderRouter([])

    const result = await router.resolve(request({ mailbox: 'owner@hotmail.com' }))

    expect(result).toMatchObject({
      status: 'provider_unavailable',
      providerId: 'microsoft',
      mailbox: 'owner@hotmail.com'
    })
  })

  it('fails closed when a registration resolves the wrong provider implementation', async () => {
    const router = new MailboxProviderRouter([
      { providerId: 'inboxes', resolve: async () => provider('fvia_inboxes') }
    ])

    const result = await router.resolve(request())

    expect(result).toMatchObject({
      status: 'provider_unavailable',
      providerId: 'inboxes'
    })
  })

  it('converts resolver rejection into typed provider unavailability', async () => {
    const router = new MailboxProviderRouter([
      { providerId: 'inboxes', resolve: async () => { throw new Error('provider page creation failed') } }
    ])

    await expect(router.resolve(request())).resolves.toMatchObject({
      status: 'provider_unavailable',
      providerId: 'inboxes',
      mailbox: 'owner@fivermail.com'
    })
  })

  it('rejects duplicate provider registrations at the composition root', () => {
    expect(() => new MailboxProviderRouter([
      { providerId: 'inboxes', resolve: async () => provider('inboxes') },
      { providerId: 'inboxes', resolve: async () => provider('inboxes') }
    ])).toThrow(/Duplicate mailbox provider registration: inboxes/)
  })

  it('prepares a challenge baseline through the resolved provider without leaking provider implementation to the caller', async () => {
    const snapshotMessageKeys = vi.fn(async (value: { mailbox: string }) => ({
      providerId: 'inboxes' as const,
      mailbox: value.mailbox,
      status: 'success' as const,
      messageKeys: ['before-send', 'before-send'],
      message: 'baseline ok'
    }))
    const inboxes: MailProvider = {
      id: 'inboxes',
      snapshotMessageKeys,
      getVerificationCode: async () => ({
        providerId: 'inboxes',
        mailbox: 'owner@fivermail.com',
        status: 'message_not_found',
        code: null,
        sender: null,
        messageKey: null,
        message: 'not ready'
      })
    }
    const router = new MailboxProviderRouter([
      { providerId: 'inboxes', resolve: async () => inboxes }
    ])

    const result = await router.prepareChallenge(request({ challengeId: 'baseline-challenge' }))

    expect(result).toMatchObject({
      status: 'success',
      providerId: 'inboxes',
      mailbox: 'owner@fivermail.com',
      challengeId: 'baseline-challenge',
      messageKeys: ['before-send']
    })
    expect(snapshotMessageKeys).toHaveBeenCalledTimes(1)
  })

  it('lets provider-owned resume freshness choose baseline-current versus bounded lookback', async () => {
    const baselineProvider: MailProvider = {
      id: 'fvia_inboxes',
      resumeFreshness: 'baseline_current',
      snapshotMessageKeys: async (value) => ({
        providerId: 'fvia_inboxes',
        mailbox: value.mailbox,
        status: 'success',
        messageKeys: ['existing-fvia'],
        message: 'baseline'
      }),
      getVerificationCode: async () => ({
        providerId: 'fvia_inboxes',
        mailbox: 'owner@fviainboxes.com',
        status: 'message_not_found',
        code: null,
        sender: null,
        messageKey: null,
        message: 'not ready'
      })
    }
    const lookbackProvider: MailProvider = {
      id: 'inboxes',
      resumeFreshness: 'lookback',
      snapshotMessageKeys: vi.fn(),
      getVerificationCode: async () => ({
        providerId: 'inboxes',
        mailbox: 'owner@fivermail.com',
        status: 'message_not_found',
        code: null,
        sender: null,
        messageKey: null,
        message: 'not ready'
      })
    }
    const router = new MailboxProviderRouter([
      { providerId: 'fvia_inboxes', resolve: async () => baselineProvider },
      { providerId: 'inboxes', resolve: async () => lookbackProvider }
    ])

    const fvia = await router.prepareResumeChallenge(
      request({ mailbox: 'owner@fviainboxes.com', challengeId: 'resume-fvia' }),
      { lookbackMs: 600_000, now: 1_000_000 }
    )
    const inboxes = await router.prepareResumeChallenge(
      request({ mailbox: 'owner@fivermail.com', challengeId: 'resume-inboxes' }),
      { lookbackMs: 600_000, now: 1_000_000 }
    )

    expect(fvia).toMatchObject({
      status: 'success',
      providerId: 'fvia_inboxes',
      challengeId: 'resume-fvia',
      messageKeys: ['existing-fvia'],
      notBefore: 1_000_000
    })
    expect(inboxes).toMatchObject({
      status: 'success',
      providerId: 'inboxes',
      challengeId: 'resume-inboxes',
      messageKeys: [],
      notBefore: 400_000
    })
    expect(lookbackProvider.snapshotMessageKeys).not.toHaveBeenCalled()
  })

  it('routes fresh-code requests with baseline and consumed identity while preserving challenge identity', async () => {
    const getVerificationCode = vi.fn(async (value: MailProviderCodeRequest): Promise<MailProviderCodeResult> => ({
      providerId: 'inboxes',
      mailbox: value.mailbox,
      status: 'success',
      code: '654321',
      sender: 'account-security-noreply@accountprotection.microsoft.com',
      messageKey: 'fresh-mail',
      message: 'ok'
    }))
    const router = new MailboxProviderRouter([
      {
        providerId: 'inboxes',
        resolve: async () => ({
          id: 'inboxes',
          getVerificationCode
        })
      }
    ])

    const result = await router.getFreshCode(request({
      challengeId: 'round-2',
      baselineMessageKeys: ['before-send'],
      consumedMessageKeys: ['submitted-1'],
      notBefore: 900_000,
      timeoutMs: 25_000
    }))

    expect(result).toMatchObject({
      status: 'success',
      providerId: 'inboxes',
      challengeId: 'round-2',
      code: '654321',
      messageKey: 'fresh-mail'
    })
    expect(getVerificationCode).toHaveBeenCalledWith(expect.objectContaining({
      excludedMessageKeys: expect.arrayContaining(['before-send', 'submitted-1']),
      notBefore: 900_000,
      timeoutMs: 25_000
    }))
  })
})
