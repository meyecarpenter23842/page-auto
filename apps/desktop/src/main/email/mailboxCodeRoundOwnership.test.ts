import { describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import type {
  MailProvider,
  MailProviderCodeRequest,
  MailProviderCodeResult,
  MailProviderMessageKeySnapshotRequest
} from './mailProvider'
import { MailboxCodeService, type MailboxCodeProviderSession } from './mailboxCodeService'

type FakePage = Page & {
  setClosed: (value: boolean) => void
  reload: ReturnType<typeof vi.fn>
}

function fakePage(url = 'https://inboxes.com/'): FakePage {
  let closed = false
  return {
    url: () => url,
    isClosed: () => closed,
    setClosed: (value: boolean) => { closed = value },
    reload: vi.fn(async () => null)
  } as unknown as FakePage
}

function codeResult(messageKey: string, code: string): MailProviderCodeResult {
  return {
    providerId: 'inboxes',
    mailbox: 'owner@getnada.com',
    status: 'success',
    code,
    sender: 'account-security-noreply@accountprotection.microsoft.com',
    messageKey,
    message: 'ok'
  }
}

function sequenceProvider(sequence: MailProviderCodeResult[]): MailProvider & { calls: MailProviderCodeRequest[] } {
  const calls: MailProviderCodeRequest[] = []
  return {
    id: 'inboxes',
    calls,
    async getVerificationCode(request) {
      calls.push(request)
      return sequence.shift() ?? {
        providerId: 'inboxes',
        mailbox: 'owner@getnada.com',
        status: 'message_not_found',
        code: null,
        sender: null,
        messageKey: null,
        message: 'none'
      }
    }
  }
}

function session(page: Page, provider: MailProvider): MailboxCodeProviderSession {
  return { providerId: 'inboxes', page, provider }
}

describe('MailboxCodeService recovery-round ownership', () => {
  it('captures a pre-Send baseline without asking the provider to read a code', async () => {
    const page = fakePage()
    const snapshotCalls: MailProviderMessageKeySnapshotRequest[] = []
    const getVerificationCode = vi.fn()
    const provider: MailProvider = {
      id: 'inboxes',
      getVerificationCode,
      async snapshotMessageKeys(request) {
        snapshotCalls.push(request)
        return {
          providerId: 'inboxes',
          mailbox: request.mailbox,
          status: 'success',
          messageKeys: ['old-code', 'newer-notification'],
          message: 'baseline'
        }
      }
    }
    const service = new MailboxCodeService({
      resolveProviderSession: async () => session(page, provider)
    })

    const result = await service.prepareChallengeBaseline({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes'
    })

    expect(result.status).toBe('success')
    expect(result.messageKeys).toEqual(['old-code', 'newer-notification'])
    expect(snapshotCalls).toEqual([{
      mailbox: 'owner@getnada.com',
      role: 'recovery',
      purpose: 'microsoft_security'
    }])
    expect(getVerificationCode).not.toHaveBeenCalled()
  })

  it('keeps submitted message identity across three challenges even when each new round passes an empty consumed list', async () => {
    const page = fakePage()
    const provider = sequenceProvider([
      codeResult('mail-a', '111111'),
      codeResult('mail-a', '111111'),
      codeResult('mail-b', '222222'),
      codeResult('mail-a', '111111'),
      codeResult('mail-b', '222222'),
      codeResult('mail-c', '333333')
    ])
    const service = new MailboxCodeService({
      resolveProviderSession: async () => session(page, provider),
      now: () => 10_000
    })

    const first = await service.getFreshCode({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      challengeId: 'challenge-a',
      consumedMessageKeys: [],
      timeoutMs: 0
    })
    const second = await service.getFreshCode({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      challengeId: 'challenge-b',
      consumedMessageKeys: [],
      timeoutMs: 0
    })
    const third = await service.getFreshCode({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      challengeId: 'challenge-c',
      consumedMessageKeys: [],
      timeoutMs: 0
    })

    expect([first.messageKey, second.messageKey, third.messageKey]).toEqual(['mail-a', 'mail-b', 'mail-c'])
    expect(third.consumedMessageKeys).toEqual(['mail-a', 'mail-b', 'mail-c'])
    expect(provider.calls.some((call) => call.excludedMessageKeys?.includes('mail-a'))).toBe(true)
    expect(provider.calls.some((call) => call.excludedMessageKeys?.includes('mail-b'))).toBe(true)
  })

  it('treats the pre-Send baseline as authority when freshness windows overlap', async () => {
    const page = fakePage()
    const provider = sequenceProvider([
      codeResult('round-a', '111111'),
      codeResult('round-b', '222222')
    ])
    const service = new MailboxCodeService({
      resolveProviderSession: async () => session(page, provider),
      now: () => 20_000
    })

    const result = await service.getFreshCode({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      challengeId: 'challenge-overlap',
      notBefore: 15_000,
      baselineMessageKeys: ['round-a'],
      consumedMessageKeys: [],
      timeoutMs: 0
    })

    expect(result.status).toBe('success')
    expect(result.messageKey).toBe('round-b')
    expect(provider.calls[0]?.excludedMessageKeys).toContain('round-a')
  })

  it('preserves cross-round consumed identity when the provider adapter/page is recreated', async () => {
    const firstPage = fakePage()
    const secondPage = fakePage()
    const firstProvider = sequenceProvider([codeResult('mail-a', '111111')])
    const secondProvider = sequenceProvider([
      codeResult('mail-a', '111111'),
      codeResult('mail-b', '222222')
    ])
    const sessions = [session(firstPage, firstProvider), session(secondPage, secondProvider)]
    const resolveProviderSession = vi.fn(async () => sessions.shift() ?? null)
    const service = new MailboxCodeService({ resolveProviderSession, now: () => 30_000 })

    const first = await service.getFreshCode({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      challengeId: 'challenge-one',
      consumedMessageKeys: [],
      timeoutMs: 0
    })
    firstPage.setClosed(true)
    const second = await service.getFreshCode({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      challengeId: 'challenge-two',
      consumedMessageKeys: [],
      timeoutMs: 0
    })

    expect(first.messageKey).toBe('mail-a')
    expect(second.messageKey).toBe('mail-b')
    expect(resolveProviderSession).toHaveBeenCalledTimes(2)
    expect(secondProvider.calls[0]?.excludedMessageKeys).toContain('mail-a')
  })
})
