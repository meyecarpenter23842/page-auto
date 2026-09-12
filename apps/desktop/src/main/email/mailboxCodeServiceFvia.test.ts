import { describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import type { MailProvider, MailProviderCodeRequest, MailProviderCodeResult } from './mailProvider'
import {
  isMailboxCodeServiceProviderId,
  MailboxCodeService,
  newestOpenFviaInboxesProviderPage,
  ownedOrNewestOpenFviaInboxesProviderPage
} from './mailboxCodeService'

type FakePage = Page & {
  reload: ReturnType<typeof vi.fn>
}

function fakePage(url: string, closed = false): FakePage {
  return {
    url: () => url,
    isClosed: () => closed,
    reload: vi.fn(async () => null)
  } as unknown as FakePage
}

function fviaResult(
  status: MailProviderCodeResult['status'],
  detail: Partial<MailProviderCodeResult> = {}
): MailProviderCodeResult {
  return {
    providerId: 'fvia_inboxes',
    mailbox: 'owner@fviainboxes.com',
    status,
    code: status === 'success' ? '123456' : null,
    sender: status === 'success' ? 'account-security-noreply@accountprotection.microsoft.com' : null,
    messageKey: status === 'success' ? 'mail-1' : null,
    message: status === 'success' ? 'ok' : 'not ready',
    ...detail
  }
}

describe('MailboxCodeService FviaInboxes migration', () => {
  it('keeps direct callers Inboxes-only unless Fvia is explicitly enabled', async () => {
    const resolveProviderSession = vi.fn()
    const service = new MailboxCodeService({ resolveProviderSession })

    const response = await service.getFreshCode({
      mailbox: 'owner@fviainboxes.com',
      providerId: 'fvia_inboxes',
      challengeId: 'legacy-default',
      consumedMessageKeys: [],
      timeoutMs: 0
    })

    expect(response.status).toBe('unsupported_mailbox')
    expect(resolveProviderSession).not.toHaveBeenCalled()
    expect(isMailboxCodeServiceProviderId('fvia_inboxes')).toBe(true)
    expect(isMailboxCodeServiceProviderId('mailto_plus')).toBe(false)
  })

  it('baselines Fvia message identity and rejects baseline/consumed keys before returning the fresh code', async () => {
    const page = fakePage('https://fviainboxes.com/')
    const calls: MailProviderCodeRequest[] = []
    const sequence = [
      fviaResult('success', { messageKey: 'before-send', code: '111111' }),
      fviaResult('success', { messageKey: 'already-submitted', code: '222222' }),
      fviaResult('success', { messageKey: 'fresh-fvia', code: '333333' })
    ]
    const provider: MailProvider = {
      id: 'fvia_inboxes',
      snapshotMessageKeys: async (request) => ({
        providerId: 'fvia_inboxes',
        mailbox: request.mailbox,
        status: 'success',
        messageKeys: ['before-send'],
        message: 'baseline ok'
      }),
      getVerificationCode: async (request) => {
        calls.push(request)
        return sequence.shift() ?? fviaResult('message_not_found')
      }
    }
    const resolveProviderSession = vi.fn(async () => ({
      providerId: 'fvia_inboxes' as const,
      page,
      provider
    }))
    const service = new MailboxCodeService({
      resolveProviderSession,
      enabledProviderIds: ['inboxes', 'fvia_inboxes'],
      now: () => 900_000
    })

    const baseline = await service.prepareChallengeBaseline({
      mailbox: 'owner@fviainboxes.com',
      providerId: 'fvia_inboxes'
    })
    expect(baseline.status).toBe('success')
    expect(baseline.messageKeys).toEqual(['before-send'])

    const response = await service.getFreshCode({
      mailbox: 'owner@fviainboxes.com',
      providerId: 'fvia_inboxes',
      challengeId: 'fvia-round-1',
      baselineMessageKeys: baseline.messageKeys,
      consumedMessageKeys: ['already-submitted'],
      timeoutMs: 0
    })

    expect(response.status).toBe('success')
    expect(response.code).toBe('333333')
    expect(response.messageKey).toBe('fresh-fvia')
    expect(response.consumedMessageKeys).toEqual(['already-submitted', 'fresh-fvia'])
    expect(calls).toHaveLength(3)
    expect(calls[0]?.excludedMessageKeys).toEqual(expect.arrayContaining(['before-send', 'already-submitted']))
    expect(page.reload).not.toHaveBeenCalled()
    expect(resolveProviderSession).toHaveBeenCalledTimes(1)
  })

  it('keeps Fvia provider page ownership on Fvia tabs without adopting Inboxes', () => {
    const inboxes = fakePage('https://inboxes.com/')
    const fviaOlder = fakePage('https://fviainboxes.com/')
    const fviaNewest = fakePage('https://www.fviainboxes.com/inbox')
    const ownedBlank = fakePage('about:blank')

    expect(newestOpenFviaInboxesProviderPage([fviaOlder, inboxes, fviaNewest])).toBe(fviaNewest)
    expect(ownedOrNewestOpenFviaInboxesProviderPage(ownedBlank, [inboxes, fviaNewest])).toBe(ownedBlank)
  })
})
