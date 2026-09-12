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
})
