import { describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import type { MailProvider, MailProviderCodeRequest, MailProviderCodeResult } from './mailProvider'
import {
  InboxesLifecycleProvider,
  newestOpenInboxesProviderPage,
  ownedOrNewestOpenInboxesProviderPage
} from './inboxesMailboxRuntime'

type FakePage = Page & {
  setUrl: (value: string) => void
  setClosed: (value: boolean) => void
  reload: ReturnType<typeof vi.fn>
  goto: ReturnType<typeof vi.fn>
}

function fakePage(initialUrl: string, closed = false): FakePage {
  let url = initialUrl
  let isClosed = closed
  const reload = vi.fn(async () => null)
  const goto = vi.fn(async (value: string) => { url = value; return null })
  return {
    url: () => url,
    isClosed: () => isClosed,
    setUrl: (value: string) => { url = value },
    setClosed: (value: boolean) => { isClosed = value },
    reload,
    goto
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

describe('InboxesLifecycleProvider', () => {
  it('reloads once after an early provider failure and preserves the bounded request budget', async () => {
    const page = fakePage('https://inboxes.com/#google_vignette')
    const base = providerWith([
      result('provider_unavailable', { message: 'popup blocks click' }),
      result('success', { messageKey: 'fresh-after-f5', code: '555555' })
    ])
    const provider = new InboxesLifecycleProvider(page, base, { now: () => 2_700_000 })

    const response = await provider.getVerificationCode({
      mailbox: 'owner@getnada.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 5_000
    })

    expect(response.status).toBe('success')
    expect(response.code).toBe('555555')
    expect(page.reload).toHaveBeenCalledTimes(1)
    expect(page.reload.mock.calls[0]?.[0]).toMatchObject({ timeout: 5_000 })
    expect(base.calls).toHaveLength(2)
  })

  it('does not start reload recovery after the original request deadline has elapsed', async () => {
    const page = fakePage('https://inboxes.com/')
    let now = 10_000
    const base: MailProvider = {
      id: 'inboxes',
      getVerificationCode: async () => {
        now = 14_000
        return result('provider_unavailable', { message: 'late popup failure' })
      }
    }
    const provider = new InboxesLifecycleProvider(page, base, { now: () => now })

    const response = await provider.getVerificationCode({
      mailbox: 'owner@getnada.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 4_000
    })

    expect(response.status).toBe('provider_unavailable')
    expect(page.reload).not.toHaveBeenCalled()
  })

  it('bounds provider recovery to one reload', async () => {
    const page = fakePage('https://inboxes.com/')
    const base = providerWith([result('provider_unavailable'), result('provider_unavailable')])
    const provider = new InboxesLifecycleProvider(page, base, { now: () => 2_800_000 })

    const response = await provider.getVerificationCode({
      mailbox: 'owner@getnada.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 5_000
    })

    expect(response.status).toBe('provider_unavailable')
    expect(page.reload).toHaveBeenCalledTimes(1)
  })

  it('does not spend a reload budget on a zero-timeout probe', async () => {
    const page = fakePage('https://inboxes.com/')
    const base = providerWith([result('provider_unavailable')])
    const provider = new InboxesLifecycleProvider(page, base, { now: () => 2_900_000 })

    const response = await provider.getVerificationCode({
      mailbox: 'owner@getnada.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 0
    })

    expect(response.status).toBe('provider_unavailable')
    expect(page.reload).not.toHaveBeenCalled()
  })

  it('recovers an escaped owned page through the Inboxes home URL', async () => {
    const page = fakePage('https://example.com/ad')
    const base = providerWith([
      result('provider_unavailable'),
      result('success', { messageKey: 'fresh-after-home', code: '818181' })
    ])
    const provider = new InboxesLifecycleProvider(page, base, { now: () => 3_000_000 })

    const response = await provider.getVerificationCode({
      mailbox: 'owner@getnada.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 5_000
    })

    expect(response.status).toBe('success')
    expect(response.code).toBe('818181')
    expect(page.goto).toHaveBeenCalledWith('https://inboxes.com/', expect.objectContaining({ timeout: 5_000 }))
  })
})

describe('Inboxes provider page ownership', () => {
  it('adopts the newest open Inboxes tab and ignores unrelated/closed tabs', () => {
    const unrelated = fakePage('https://login.live.com/')
    const older = fakePage('https://inboxes.com/')
    const closed = fakePage('https://inboxes.com/mail/123', true)
    const newest = fakePage('https://www.inboxes.com/')

    expect(newestOpenInboxesProviderPage([unrelated, older, closed, newest])).toBe(newest)
  })

  it('reclaims the explicitly owned provider page even when refresh left it at about:blank', () => {
    const unrelatedBlank = fakePage('about:blank')
    const ownedBlank = fakePage('about:blank')
    const inboxes = fakePage('https://inboxes.com/')

    expect(ownedOrNewestOpenInboxesProviderPage(ownedBlank, [unrelatedBlank, inboxes])).toBe(ownedBlank)
  })

  it('falls back to a live Inboxes tab when the previously owned page is closed', () => {
    const closedOwned = fakePage('about:blank', true)
    const inboxes = fakePage('https://inboxes.com/')

    expect(ownedOrNewestOpenInboxesProviderPage(closedOwned, [inboxes])).toBe(inboxes)
  })
})
