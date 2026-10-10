import { describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import type {
  MailProvider,
  MailProviderCodeRequest,
  MailProviderCodeResult,
  MailProviderMessageKeySnapshotResult
} from './mailProvider'
import {
  createFviaInboxesMailboxRuntime,
  FviaInboxesLifecycleProvider,
  isFviaInboxesProviderPageUrl,
  newestOpenFviaInboxesProviderPage,
  ownedOrNewestOpenFviaInboxesProviderPage
} from './fviaInboxesMailboxRuntime'

type FakePage = Page & {
  setUrl: (value: string) => void
  setClosed: (value: boolean) => void
  reload: ReturnType<typeof vi.fn>
}

function fakePage(initialUrl: string, closed = false): FakePage {
  let url = initialUrl
  let isClosed = closed
  return {
    url: () => url,
    isClosed: () => isClosed,
    setUrl: (value: string) => { url = value },
    setClosed: (value: boolean) => { isClosed = value },
    reload: vi.fn(async () => null)
  } as unknown as FakePage
}

function codeResult(
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

function snapshotResult(): MailProviderMessageKeySnapshotResult {
  return {
    providerId: 'fvia_inboxes',
    mailbox: 'owner@fviainboxes.com',
    status: 'success',
    messageKeys: ['mail-before-send'],
    message: 'baseline ok'
  }
}

describe('FviaInboxesLifecycleProvider', () => {
  it('returns the provider baseline when the owned Fvia page remains valid', async () => {
    const page = fakePage('https://fviainboxes.com/')
    const provider: MailProvider = {
      id: 'fvia_inboxes',
      snapshotMessageKeys: async () => snapshotResult(),
      getVerificationCode: async () => codeResult('message_not_found')
    }
    const runtimeProvider = new FviaInboxesLifecycleProvider(page, provider)

    const result = await runtimeProvider.snapshotMessageKeys({
      mailbox: 'owner@fviainboxes.com',
      role: 'recovery',
      purpose: 'microsoft_security'
    })

    expect(result).toEqual(snapshotResult())
  })

  it('fails closed when Fvia escapes to another site during the pre-Send baseline', async () => {
    const page = fakePage('https://fviainboxes.com/')
    const provider: MailProvider = {
      id: 'fvia_inboxes',
      snapshotMessageKeys: async () => {
        page.setUrl('https://example.com/ad')
        return snapshotResult()
      },
      getVerificationCode: async () => codeResult('message_not_found')
    }
    const runtimeProvider = new FviaInboxesLifecycleProvider(page, provider)

    const result = await runtimeProvider.snapshotMessageKeys({
      mailbox: 'owner@fviainboxes.com',
      role: 'recovery',
      purpose: 'microsoft_security'
    })

    expect(result.status).toBe('provider_unavailable')
    expect(result.messageKeys).toEqual([])
    expect(result.message).toContain('đổi/đóng provider page')
  })

  it('fails closed when the owned Fvia page closes during baseline', async () => {
    const page = fakePage('https://fviainboxes.com/')
    const provider: MailProvider = {
      id: 'fvia_inboxes',
      snapshotMessageKeys: async () => {
        page.setClosed(true)
        return snapshotResult()
      },
      getVerificationCode: async () => codeResult('message_not_found')
    }
    const runtimeProvider = new FviaInboxesLifecycleProvider(page, provider)

    const result = await runtimeProvider.snapshotMessageKeys({
      mailbox: 'owner@fviainboxes.com',
      role: 'recovery',
      purpose: 'microsoft_security'
    })

    expect(result.status).toBe('provider_unavailable')
    expect(result.messageKeys).toEqual([])
  })

  it('does not inherit Inboxes reload recovery when Fvia reports unavailable', async () => {
    const page = fakePage('https://fviainboxes.com/')
    const calls: MailProviderCodeRequest[] = []
    const provider: MailProvider = {
      id: 'fvia_inboxes',
      getVerificationCode: async (request) => {
        calls.push(request)
        return codeResult('provider_unavailable')
      }
    }
    const runtimeProvider = new FviaInboxesLifecycleProvider(page, provider)

    const result = await runtimeProvider.getVerificationCode({
      mailbox: 'owner@fviainboxes.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 5_000
    })

    expect(result.status).toBe('provider_unavailable')
    expect(calls).toHaveLength(1)
    expect(page.reload).not.toHaveBeenCalled()
  })
})

describe('Fvia provider page ownership', () => {
  it('recognizes only the Fvia provider host family', () => {
    expect(isFviaInboxesProviderPageUrl('https://fviainboxes.com/')).toBe(true)
    expect(isFviaInboxesProviderPageUrl('https://www.fviainboxes.com/inbox')).toBe(true)
    expect(isFviaInboxesProviderPageUrl('https://inboxes.com/')).toBe(false)
    expect(isFviaInboxesProviderPageUrl('https://example.com/')).toBe(false)
    expect(isFviaInboxesProviderPageUrl('not-a-url')).toBe(false)
  })

  it('adopts the newest open Fvia tab and ignores Inboxes/closed tabs', () => {
    const fviaOlder = fakePage('https://fviainboxes.com/')
    const inboxes = fakePage('https://inboxes.com/')
    const closed = fakePage('https://www.fviainboxes.com/inbox', true)
    const fviaNewest = fakePage('https://www.fviainboxes.com/inbox')

    expect(newestOpenFviaInboxesProviderPage([fviaOlder, inboxes, closed, fviaNewest])).toBe(fviaNewest)
  })

  it('keeps an explicitly owned blank page and falls back when that page is closed', () => {
    const ownedBlank = fakePage('about:blank')
    const closedOwned = fakePage('about:blank', true)
    const fvia = fakePage('https://fviainboxes.com/')

    expect(ownedOrNewestOpenFviaInboxesProviderPage(ownedBlank, [fvia])).toBe(ownedBlank)
    expect(ownedOrNewestOpenFviaInboxesProviderPage(closedOwned, [fvia])).toBe(fvia)
  })

  it('composes the concrete Fvia provider on an existing Fvia-owned page', async () => {
    const page = fakePage('https://fviainboxes.com/')
    const createPage = vi.fn(async () => fakePage('about:blank'))

    const runtime = await createFviaInboxesMailboxRuntime({
      preferredPage: null,
      pages: [fakePage('https://inboxes.com/'), page],
      createPage
    })

    expect(runtime?.page).toBe(page)
    expect(runtime?.provider.id).toBe('fvia_inboxes')
    expect(runtime?.isReusablePageUrl('https://www.fviainboxes.com/inbox')).toBe(true)
    expect(createPage).not.toHaveBeenCalled()
  })
})
