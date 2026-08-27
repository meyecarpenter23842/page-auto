import { describe, expect, it } from 'vitest'
import type { BrowserContext, Page } from 'playwright-core'
import {
  adoptNewestMicrosoftFlowPage,
  closeMicrosoftOwnedOpenerChain,
  isMicrosoftAuthNavigationUrl,
  isMicrosoftOwnedNavigationUrl,
  microsoftRouteLogLabel,
  waitForMicrosoftOwnedPage
} from './emailMicrosoftPageOwnership'

type FakePage = Page & { closedFlag?: boolean }
type FakeContext = BrowserContext & { pagesList: Page[] }

function fakeContext(): FakeContext {
  const pagesList: Page[] = []
  return {
    pagesList,
    pages: () => pagesList
  } as unknown as FakeContext
}

function fakePage(url: string, context: FakeContext, opener: Page | null = null): FakePage {
  let currentUrl = url
  let closed = false
  const page = {
    url: () => currentUrl,
    isClosed: () => closed,
    opener: async () => opener,
    context: () => context,
    close: async () => { closed = true },
    bringToFront: async () => undefined,
    waitForTimeout: async () => undefined,
    waitForURL: async (matcher: (url: URL) => boolean) => {
      currentUrl = 'https://login.live.com/oauth20_authorize.srf?state=dynamic'
      matcher(new URL(currentUrl))
    }
  } as unknown as FakePage
  Object.defineProperty(page, 'closedFlag', { get: () => closed })
  context.pagesList.push(page)
  return page
}

describe('Microsoft page ownership', () => {
  it('recognizes Microsoft routes and only login hosts as auth routes', () => {
    expect(isMicrosoftOwnedNavigationUrl('https://login.live.com/oauth20_authorize.srf')).toBe(true)
    expect(isMicrosoftOwnedNavigationUrl('https://outlook.live.com/mail/0/')).toBe(true)
    expect(isMicrosoftAuthNavigationUrl('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')).toBe(true)
    expect(isMicrosoftAuthNavigationUrl('https://outlook.live.com/mail/0/')).toBe(false)
    expect(isMicrosoftOwnedNavigationUrl('https://login.live.com.evil.example/oauth20_authorize.srf')).toBe(false)
    expect(isMicrosoftAuthNavigationUrl('about:blank')).toBe(false)
  })

  it('logs only Microsoft host/path and drops dynamic query values', () => {
    expect(microsoftRouteLogLabel('https://login.live.com/oauth20_authorize.srf?state=secret&login_hint=user@example.com'))
      .toBe('login.live.com/oauth20_authorize.srf')
  })

  it('waits for a newly opened blank popup to become Microsoft-owned', async () => {
    const context = fakeContext()
    const popup = fakePage('about:blank', context)
    expect(await waitForMicrosoftOwnedPage(popup, 500)).toBe(true)
    expect(popup.url()).toContain('login.live.com/oauth20_authorize.srf')
  })

  it('adopts a Microsoft auth page created after the login loop started', async () => {
    const context = fakeContext()
    const unrelated = fakePage('https://example.com/operator-tab', context)
    const outlook = fakePage('https://outlook.live.com/mail/0/', context)
    const current = fakePage('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=old', context)
    const pagesAtFlowStart = new Set<Page>(context.pagesList)
    const next = fakePage('https://login.live.com/oauth20_authorize.srf?state=new', context)

    const adopted = await adoptNewestMicrosoftFlowPage(current, pagesAtFlowStart)

    expect(adopted).toBe(next)
    expect(current.closedFlag).toBe(true)
    expect(next.closedFlag).toBe(false)
    expect(outlook.closedFlag).toBe(false)
    expect(unrelated.closedFlag).toBe(false)
  })

  it('closes opener and detached auth siblings but preserves Outlook and unrelated tabs', async () => {
    const context = fakeContext()
    const unrelated = fakePage('https://example.com/operator-tab', context)
    const outlook = fakePage('https://outlook.live.com/mail/0/', context)
    const detachedAuth = fakePage('https://login.microsoftonline.com/common/oauth2/v2.0/authorize', context)
    const source = fakePage('https://login.live.com/oauth20_authorize.srf', context, unrelated)
    const active = fakePage('https://login.live.com/oauth20_authorize.srf?state=active', context, source)

    await closeMicrosoftOwnedOpenerChain(active)

    expect(source.closedFlag).toBe(true)
    expect(detachedAuth.closedFlag).toBe(true)
    expect(active.closedFlag).toBe(false)
    expect(outlook.closedFlag).toBe(false)
    expect(unrelated.closedFlag).toBe(false)
  })
})
