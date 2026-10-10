import { describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import {
  createMailtoPlusMailboxRuntime,
  isMailtoPlusProviderPageUrl,
  newestOpenMailtoPlusProviderPage,
  ownedOrNewestOpenMailtoPlusProviderPage
} from './mailtoPlusMailboxRuntime'

type FakePage = Page & {
  setClosed: (value: boolean) => void
}

function fakePage(url: string, closed = false): FakePage {
  let isClosed = closed
  return {
    url: () => url,
    isClosed: () => isClosed,
    setClosed: (value: boolean) => { isClosed = value }
  } as unknown as FakePage
}

describe('MailtoPlus mailbox runtime', () => {
  it('recognizes only the TempMail.Plus provider host family', () => {
    expect(isMailtoPlusProviderPageUrl('https://tempmail.plus/api/mails')).toBe(true)
    expect(isMailtoPlusProviderPageUrl('https://www.tempmail.plus/')).toBe(true)
    expect(isMailtoPlusProviderPageUrl('https://inboxes.com/')).toBe(false)
    expect(isMailtoPlusProviderPageUrl('not-a-url')).toBe(false)
  })

  it('adopts the newest open MailtoPlus page without taking Inboxes/Fvia pages', () => {
    const old = fakePage('https://tempmail.plus/api/mails?email=a%40mailto.plus')
    const inboxes = fakePage('https://inboxes.com/')
    const fvia = fakePage('https://fviainboxes.com/')
    const newest = fakePage('https://www.tempmail.plus/')

    expect(newestOpenMailtoPlusProviderPage([old, inboxes, fvia, newest])).toBe(newest)
  })

  it('keeps explicit page ownership and falls back when the owned page closes', () => {
    const ownedBlank = fakePage('about:blank')
    const closedOwned = fakePage('about:blank', true)
    const mailto = fakePage('https://tempmail.plus/api/mails')

    expect(ownedOrNewestOpenMailtoPlusProviderPage(ownedBlank, [mailto])).toBe(ownedBlank)
    expect(ownedOrNewestOpenMailtoPlusProviderPage(closedOwned, [mailto])).toBe(mailto)
  })

  it('composes MailtoPlusProvider on the provider-owned page', async () => {
    const mailto = fakePage('https://tempmail.plus/api/mails')
    const createPage = vi.fn(async () => fakePage('about:blank'))

    const runtime = await createMailtoPlusMailboxRuntime({
      preferredPage: null,
      pages: [fakePage('https://inboxes.com/'), mailto],
      createPage
    })

    expect(runtime?.page).toBe(mailto)
    expect(runtime?.provider.id).toBe('mailto_plus')
    expect(runtime?.provider.resumeFreshness).toBe('baseline_current')
    expect(createPage).not.toHaveBeenCalled()
  })
})
