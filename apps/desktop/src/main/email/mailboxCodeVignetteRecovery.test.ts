import { describe, expect, it, vi } from 'vitest'
import type { BrowserContext, Page } from 'playwright-core'
import { MailboxCodeService, type MailboxCodeProviderSession } from './mailboxCodeService'
import {
  closeUnexpectedInboxesPopupPages,
  hasInboxesProviderEscaped,
  isInboxesGoogleVignetteUrl
} from './inboxesVignetteGuard'
import type { MailProvider } from './mailProvider'

function providerSuccess(code: string) {
  return {
    providerId: 'inboxes' as const,
    mailbox: 'owner@getnada.com',
    status: 'success' as const,
    code,
    sender: 'Microsoft account team',
    messageKey: `message:${code}`,
    message: 'ok'
  }
}

describe('Inboxes vignette URL guard', () => {
  it('detects only the Inboxes google_vignette hash', () => {
    expect(isInboxesGoogleVignetteUrl('https://inboxes.com/#google_vignette')).toBe(true)
    expect(isInboxesGoogleVignetteUrl('https://www.inboxes.com/#google_vignette=1')).toBe(true)
    expect(isInboxesGoogleVignetteUrl('https://inboxes.com/')).toBe(false)
    expect(isInboxesGoogleVignetteUrl('https://lenovo.com/#google_vignette')).toBe(false)
  })
})

describe('unexpected Inboxes popup cleanup', () => {
  it('closes only a newly opened external popup whose opener is the provider page', async () => {
    const pages: Page[] = []
    const context = { pages: () => pages } as unknown as BrowserContext
    const providerPage = {
      isClosed: () => false,
      url: () => 'https://inboxes.com/',
      context: () => context,
      waitForTimeout: async () => undefined
    } as unknown as Page
    const existingMicrosoft = {
      isClosed: () => false,
      url: () => 'https://login.live.com/',
      opener: async () => null
    } as unknown as Page
    const closePopup = vi.fn(async () => undefined)
    const adPopup = {
      isClosed: () => false,
      url: () => 'https://www.lenovo.com/deals',
      opener: async () => providerPage,
      waitForLoadState: async () => undefined,
      close: closePopup
    } as unknown as Page

    pages.push(providerPage, existingMicrosoft)
    const before = [...pages]
    pages.push(adPopup)

    expect(await closeUnexpectedInboxesPopupPages(providerPage, before)).toBe(1)
    expect(closePopup).toHaveBeenCalledTimes(1)
  })

  it('recognizes when the owned provider page itself escaped Inboxes', () => {
    const page = {
      isClosed: () => false,
      url: () => 'https://www.lenovo.com/deals'
    } as unknown as Page
    expect(hasInboxesProviderEscaped(page)).toBe(true)
  })
})

describe('MailboxCodeService vignette recovery', () => {
  it('discards a result from an ad-intercepted click, closes the ad tab, reloads Inboxes, and retries', async () => {
    let providerUrl = 'https://inboxes.com/'
    const pages: Page[] = []
    const reload = vi.fn(async () => undefined)
    const context = { pages: () => pages } as unknown as BrowserContext
    const providerPage = {
      isClosed: () => false,
      url: () => providerUrl,
      context: () => context,
      waitForTimeout: async () => undefined,
      reload
    } as unknown as Page
    pages.push(providerPage)

    let calls = 0
    const provider: MailProvider = {
      id: 'inboxes',
      getVerificationCode: vi.fn(async () => {
        calls += 1
        if (calls === 1) {
          const adPopup = {
            isClosed: () => false,
            url: () => 'https://www.lenovo.com/deals',
            opener: async () => providerPage,
            waitForLoadState: async () => undefined,
            close: async () => undefined
          } as unknown as Page
          pages.push(adPopup)
          return providerSuccess('111111')
        }
        return providerSuccess('654321')
      })
    }

    const session: MailboxCodeProviderSession = { providerId: 'inboxes', page: providerPage, provider }
    const service = new MailboxCodeService({ resolveProviderSession: async () => session })
    const result = await service.getFreshCode({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      challengeId: 'challenge-1',
      consumedMessageKeys: [],
      timeoutMs: 5_000
    })

    expect(result.status).toBe('success')
    expect(result.code).toBe('654321')
    expect(calls).toBe(2)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('restores the provider home when the owned Inboxes tab is redirected to an external ad page', async () => {
    let providerUrl = 'https://inboxes.com/'
    const goto = vi.fn(async (url: string) => { providerUrl = url })
    const context = { pages: () => [providerPage] } as unknown as BrowserContext
    const providerPage = {
      isClosed: () => false,
      url: () => providerUrl,
      context: () => context,
      waitForTimeout: async () => undefined,
      goto
    } as unknown as Page

    let calls = 0
    const provider: MailProvider = {
      id: 'inboxes',
      getVerificationCode: vi.fn(async () => {
        calls += 1
        if (calls === 1) {
          providerUrl = 'https://www.lenovo.com/deals'
          return providerSuccess('111111')
        }
        return providerSuccess('654321')
      })
    }

    const session: MailboxCodeProviderSession = { providerId: 'inboxes', page: providerPage, provider }
    const service = new MailboxCodeService({ resolveProviderSession: async () => session })
    const result = await service.getFreshCode({
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      challengeId: 'challenge-2',
      consumedMessageKeys: [],
      timeoutMs: 5_000
    })

    expect(result.status).toBe('success')
    expect(result.code).toBe('654321')
    expect(goto).toHaveBeenCalledWith('https://inboxes.com/', expect.objectContaining({ waitUntil: 'domcontentloaded' }))
    expect(calls).toBe(2)
  })
})
