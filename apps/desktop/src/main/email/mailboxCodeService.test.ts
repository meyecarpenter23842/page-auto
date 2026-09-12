import { describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import type { MailProvider, MailProviderCodeRequest, MailProviderCodeResult } from './mailProvider'
import {
  MailboxCodeService,
  type MailboxCodeProviderSession
} from './mailboxCodeService'

type FakePage = Page & {
  setClosed: (value: boolean) => void
  close: ReturnType<typeof vi.fn>
  reload: ReturnType<typeof vi.fn>
}

function fakePage(url: string, closed = false): FakePage {
  let isClosed = closed
  const close = vi.fn(async () => { isClosed = true })
  const reload = vi.fn(async () => null)
  return {
    url: () => url,
    isClosed: () => isClosed,
    setClosed: (value: boolean) => { isClosed = value },
    close,
    reload
  } as unknown as FakePage
}

function result(
  status: MailProviderCodeResult['status'],
  detail: Partial<MailProviderCodeResult> = {}
): MailProviderCodeResult {
  return {
    providerId: 'inboxes',
    mailbox: 'owner@getnada.com',
    status,
    code: status === 'success' ? '123456' : null,
    sender: status === 'success' ? 'account-security-noreply@accountprotection.microsoft.com' : null,
    messageKey: status === 'success' ? 'mail-1' : null,
    message: status === 'success' ? 'ok' : 'not ready',
    ...detail
  }
}

function providerWith(sequence: MailProviderCodeResult[]): MailProvider & { calls: MailProviderCodeRequest[] } {
  const calls: MailProviderCodeRequest[] = []
  return {
    id: 'inboxes',
    calls,
    getVerificationCode: async (request) => {
      calls.push(request)
      return sequence.shift() ?? result('message_not_found')
    }
  }
}

function session(page: Page, provider: MailProvider): MailboxCodeProviderSession {
  return { providerId: 'inboxes', page, provider }
}

describe('MailboxCodeService', () => {
  it('fails closed when mailbox and providerId do not match', async () => {
    const resolveProviderSession = vi.fn()
    const service = new MailboxCodeService({ resolveProviderSession })

    const response = await service.getFreshCode({
      mailbox: 'owner@hotmail.com',
      providerId: 'inboxes',
      challengeId: 'challenge-1',
      consumedMessageKeys: [],
      timeoutMs: 0
    })

    expect(response.status).toBe('unsupported_mailbox')
    expect(response.challengeId).toBe('challenge-1')
    expect(resolveProviderSession).not.toHaveBeenCalled()
  })

  it('keeps provider availability at the injected composition boundary instead of a Common whitelist', async () => {
    const resolveProviderSession = vi.fn(async () => null)
    const service = new MailboxCodeService({ resolveProviderSession })

    const response = await service.getFreshCode({
      mailbox: 'owner@fviainboxes.com',
      providerId: 'fvia_inboxes',
      challengeId: 'challenge-2',
      consumedMessageKeys: [],
      timeoutMs: 0
    })

    expect(response.status).toBe('provider_unavailable')
    expect(resolveProviderSession).toHaveBeenCalledWith('fvia_inboxes', null)
  })

  it('converts provider-session resolver rejection into provider_unavailable', async () => {
    const resolveProviderSession = vi.fn(async () => {
      throw new Error('browser context closed')
    })
    const service = new MailboxCodeService({ resolveProviderSession })

    const response = await service.getFreshCode({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      challengeId: 'challenge-resolver-crash',
      consumedMessageKeys: [],
      timeoutMs: 0
    })

    expect(response.status).toBe('provider_unavailable')
    expect(response.challengeId).toBe('challenge-resolver-crash')
    expect(response.code).toBeNull()
    expect(resolveProviderSession).toHaveBeenCalledTimes(1)
  })

  it('skips durable consumed message keys and returns the next fresh message', async () => {
    const page = fakePage('https://inboxes.com/')
    const provider = providerWith([
      result('success', { messageKey: 'old-key', code: '111111' }),
      result('success', { messageKey: 'fresh-key', code: '222222' })
    ])
    const resolveProviderSession = vi.fn(async () => session(page, provider))
    const service = new MailboxCodeService({ resolveProviderSession, now: () => 1_000_000 })

    const response = await service.getFreshCode({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      challengeId: 'challenge-3',
      notBefore: 999_000,
      consumedMessageKeys: ['old-key'],
      timeoutMs: 0
    })

    expect(response.status).toBe('success')
    expect(response.code).toBe('222222')
    expect(response.messageKey).toBe('fresh-key')
    expect(response.consumedMessageKeys).toEqual(['old-key', 'fresh-key'])
    expect(provider.calls).toHaveLength(2)
    expect(resolveProviderSession).toHaveBeenCalledTimes(1)
  })

  it('recreates/adopts once when the provider page closes and still rejects a previously consumed key', async () => {
    const firstPage = fakePage('https://inboxes.com/')
    const secondPage = fakePage('https://inboxes.com/')
    const firstProvider: MailProvider = {
      id: 'inboxes',
      getVerificationCode: async () => {
        firstPage.setClosed(true)
        return result('provider_unavailable', { message: 'page closed' })
      }
    }
    const secondProvider = providerWith([
      result('success', { messageKey: 'old-key', code: '111111' }),
      result('success', { messageKey: 'fresh-key', code: '333333' })
    ])
    const sessions = [session(firstPage, firstProvider), session(secondPage, secondProvider)]
    const resolveProviderSession = vi.fn(async () => sessions.shift() ?? null)
    const service = new MailboxCodeService({ resolveProviderSession, now: () => 2_000_000 })

    const response = await service.getFreshCode({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      challengeId: 'challenge-4',
      consumedMessageKeys: ['old-key'],
      timeoutMs: 0
    })

    expect(response.status).toBe('success')
    expect(response.messageKey).toBe('fresh-key')
    expect(response.code).toBe('333333')
    expect(resolveProviderSession).toHaveBeenCalledTimes(2)
    expect(firstPage.close).not.toHaveBeenCalled()
    expect(secondPage.close).not.toHaveBeenCalled()
  })

  it('re-adopts when a page closes during read even if the provider surfaces message_not_found', async () => {
    const firstPage = fakePage('https://inboxes.com/')
    const secondPage = fakePage('https://inboxes.com/')
    const firstProvider: MailProvider = {
      id: 'inboxes',
      getVerificationCode: async () => {
        firstPage.setClosed(true)
        return result('message_not_found', { message: 'page disappeared during read' })
      }
    }
    const secondProvider = providerWith([
      result('success', { messageKey: 'fresh-after-recovery', code: '444444' })
    ])
    const sessions = [session(firstPage, firstProvider), session(secondPage, secondProvider)]
    const resolveProviderSession = vi.fn(async () => sessions.shift() ?? null)
    const service = new MailboxCodeService({ resolveProviderSession, now: () => 2_500_000 })

    const response = await service.getFreshCode({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      challengeId: 'challenge-read-close',
      consumedMessageKeys: [],
      timeoutMs: 0
    })

    expect(response.status).toBe('success')
    expect(response.messageKey).toBe('fresh-after-recovery')
    expect(response.code).toBe('444444')
    expect(resolveProviderSession).toHaveBeenCalledTimes(2)
    expect(firstPage.close).not.toHaveBeenCalled()
    expect(secondPage.close).not.toHaveBeenCalled()
  })

  it('reuses the same open provider session across challenge calls', async () => {
    const page = fakePage('https://inboxes.com/')
    const provider = providerWith([
      result('success', { messageKey: 'mail-1', code: '111111' }),
      result('success', { messageKey: 'mail-2', code: '222222' })
    ])
    const resolveProviderSession = vi.fn(async () => session(page, provider))
    const service = new MailboxCodeService({ resolveProviderSession, now: () => 3_000_000 })

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
      consumedMessageKeys: first.consumedMessageKeys,
      timeoutMs: 0
    })

    expect(first.messageKey).toBe('mail-1')
    expect(second.messageKey).toBe('mail-2')
    expect(resolveProviderSession).toHaveBeenCalledTimes(1)
  })

  it('passes freshness and polling bounds to the provider without owning Microsoft actions', async () => {
    const page = fakePage('https://inboxes.com/')
    const provider = providerWith([result('message_not_found')])
    const service = new MailboxCodeService({
      resolveProviderSession: async () => session(page, provider),
      now: () => 4_000_000
    })

    await service.getFreshCode({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      challengeId: 'challenge-5',
      notBefore: 3_999_000,
      consumedMessageKeys: [],
      timeoutMs: 0,
      pollIntervalMs: 750
    })

    expect(provider.calls[0]).toMatchObject({
      mailbox: 'owner@getnada.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      notBefore: 3_999_000,
      timeoutMs: 0,
      pollIntervalMs: 750
    })
  })
})
