import { describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import type { MailProvider, MailProviderCodeRequest, MailProviderCodeResult } from './mailProvider'
import {
  MailboxCodeService,
  newestOpenInboxesProviderPage,
  ownedOrNewestOpenInboxesProviderPage,
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

  it('keeps non-Inboxes providers out of the new background boundary', async () => {
    const resolveProviderSession = vi.fn()
    const service = new MailboxCodeService({ resolveProviderSession })

    const response = await service.getFreshCode({
      mailbox: 'owner@fviainboxes.com',
      providerId: 'fvia_inboxes',
      challengeId: 'challenge-2',
      consumedMessageKeys: [],
      timeoutMs: 0
    })

    expect(response.status).toBe('unsupported_mailbox')
    expect(resolveProviderSession).not.toHaveBeenCalled()
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

  it('reloads once after an early Inboxes provider failure, then reuses the same owned page for the recreated adapter', async () => {
    const page = fakePage('https://inboxes.com/#google_vignette')
    const blockedProvider = providerWith([
      result('provider_unavailable', { message: 'popup blocks click' })
    ])
    const recoveredProvider = providerWith([
      result('success', { messageKey: 'fresh-after-f5', code: '555555' })
    ])
    const sessions = [session(page, blockedProvider), session(page, recoveredProvider)]
    const preferredPages: Array<Page | null | undefined> = []
    const resolveProviderSession = vi.fn(async (_providerId, preferredPage?: Page | null) => {
      preferredPages.push(preferredPage)
      return sessions.shift() ?? null
    })
    const service = new MailboxCodeService({ resolveProviderSession, now: () => 2_700_000 })

    const response = await service.getFreshCode({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      challengeId: 'challenge-popup-reload',
      consumedMessageKeys: [],
      timeoutMs: 5_000
    })

    expect(response.status).toBe('success')
    expect(response.code).toBe('555555')
    expect(page.reload).toHaveBeenCalledTimes(1)
    expect(resolveProviderSession).toHaveBeenCalledTimes(2)
    expect(preferredPages).toEqual([null, page])
    expect(page.close).not.toHaveBeenCalled()
    expect(page.reload.mock.calls[0]?.[0]).toMatchObject({ timeout: 5_000 })
  })

  it('does not start an F5-style recovery after the original request deadline has elapsed', async () => {
    const page = fakePage('https://inboxes.com/#google_vignette')
    let now = 10_000
    const provider: MailProvider = {
      id: 'inboxes',
      getVerificationCode: async () => {
        now = 14_000
        return result('provider_unavailable', { message: 'late popup failure' })
      }
    }
    const service = new MailboxCodeService({
      resolveProviderSession: async () => session(page, provider),
      now: () => now
    })

    const response = await service.getFreshCode({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      challengeId: 'challenge-popup-deadline',
      consumedMessageKeys: [],
      timeoutMs: 4_000
    })

    expect(response.status).toBe('provider_unavailable')
    expect(page.reload).not.toHaveBeenCalled()
  })

  it('bounds the F5-style recovery to one reload', async () => {
    const page = fakePage('https://inboxes.com/#google_vignette')
    const first = providerWith([result('provider_unavailable')])
    const second = providerWith([result('provider_unavailable')])
    const sessions = [session(page, first), session(page, second)]
    const service = new MailboxCodeService({
      resolveProviderSession: async () => sessions.shift() ?? null,
      now: () => 2_800_000
    })

    const response = await service.getFreshCode({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      challengeId: 'challenge-popup-reload-bounded',
      consumedMessageKeys: [],
      timeoutMs: 5_000
    })

    expect(response.status).toBe('provider_unavailable')
    expect(page.reload).toHaveBeenCalledTimes(1)
  })

  it('does not spend a reload budget on a zero-timeout probe', async () => {
    const page = fakePage('https://inboxes.com/#google_vignette')
    const provider = providerWith([result('provider_unavailable')])
    const service = new MailboxCodeService({
      resolveProviderSession: async () => session(page, provider),
      now: () => 2_900_000
    })

    const response = await service.getFreshCode({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      challengeId: 'challenge-zero-probe',
      consumedMessageKeys: [],
      timeoutMs: 0
    })

    expect(response.status).toBe('provider_unavailable')
    expect(page.reload).not.toHaveBeenCalled()
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

describe('newestOpenInboxesProviderPage', () => {
  it('adopts the newest open Inboxes tab and ignores unrelated/closed tabs', () => {
    const unrelated = fakePage('https://login.live.com/')
    const older = fakePage('https://inboxes.com/')
    const closed = fakePage('https://inboxes.com/mail/123', true)
    const newest = fakePage('https://www.inboxes.com/')

    expect(newestOpenInboxesProviderPage([unrelated, older, closed, newest])).toBe(newest)
  })

  it('returns null when no reusable Inboxes provider page exists', () => {
    expect(newestOpenInboxesProviderPage([
      fakePage('about:blank'),
      fakePage('https://fviainboxes.com/')
    ])).toBeNull()
  })
})

describe('ownedOrNewestOpenInboxesProviderPage', () => {
  it('reclaims the explicitly owned provider page even when refresh left it at about:blank', () => {
    const unrelatedBlank = fakePage('about:blank')
    const ownedBlank = fakePage('about:blank')
    const inboxes = fakePage('https://inboxes.com/')

    expect(ownedOrNewestOpenInboxesProviderPage(ownedBlank, [unrelatedBlank, inboxes])).toBe(ownedBlank)
  })

  it('never adopts an unrelated blank page when there is no explicit ownership', () => {
    const unrelatedBlank = fakePage('about:blank')
    const inboxes = fakePage('https://inboxes.com/')

    expect(ownedOrNewestOpenInboxesProviderPage(null, [unrelatedBlank, inboxes])).toBe(inboxes)
    expect(ownedOrNewestOpenInboxesProviderPage(null, [unrelatedBlank])).toBeNull()
  })

  it('falls back to a live Inboxes tab when the previously owned page is closed', () => {
    const closedOwned = fakePage('about:blank', true)
    const inboxes = fakePage('https://inboxes.com/')

    expect(ownedOrNewestOpenInboxesProviderPage(closedOwned, [inboxes])).toBe(inboxes)
  })
})
