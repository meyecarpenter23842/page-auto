import type { BrowserContext, Locator, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../shared/appSettings'
import { classifyFacebookProfileActor, ensureFacebookProfileIdentity } from './facebookProfileIdentity'

function hiddenLocator(): Locator {
  return {
    first: () => hiddenLocator(),
    isVisible: async () => false
  } as unknown as Locator
}

function fakePage(): Page {
  let currentUrl = 'https://www.facebook.com/'
  return {
    url: () => currentUrl,
    goto: async (url: string) => {
      currentUrl = url
      return null
    },
    waitForTimeout: async () => undefined,
    locator: () => hiddenLocator(),
    getByText: () => hiddenLocator()
  } as unknown as Page
}

function fakeContext(cUser: string, initialIUser: string | null): { context: BrowserContext; cleared: () => number } {
  let iUser = initialIUser
  let clearCalls = 0
  const context = {
    cookies: async () => [
      { name: 'c_user', value: cUser, domain: '.facebook.com', path: '/' },
      ...(iUser ? [{ name: 'i_user', value: iUser, domain: '.facebook.com', path: '/' }] : [])
    ],
    clearCookies: async (filter?: { name?: string | RegExp }) => {
      clearCalls += 1
      if (filter?.name === 'i_user') iUser = null
    }
  } as unknown as BrowserContext
  return { context, cleared: () => clearCalls }
}

function browserSettings() {
  return { ...DEFAULT_APP_SETTINGS.browser, pageSettleDelayMs: 0 }
}

describe('Facebook Profile actor identity', () => {
  it('treats any active i_user as Page actor instead of trusting c_user alone', () => {
    expect(classifyFacebookProfileActor(null)).toBe('profile')
    expect(classifyFacebookProfileActor('')).toBe('profile')
    expect(classifyFacebookProfileActor('90001')).toBe('page')
  })

  it('clears active Page i_user, returns to Home and re-verifies the account owner', async () => {
    const { context, cleared } = fakeContext('10007', '90001')
    const result = await ensureFacebookProfileIdentity(
      context,
      fakePage(),
      browserSettings(),
      '10007'
    )

    expect(result.status).toBe('success')
    expect(cleared()).toBe(1)
    expect(result.sessionCookie).toContain('c_user=10007')
    expect(result.sessionCookie).not.toContain('i_user=')
  })

  it('blocks automation if c_user belongs to a different account', async () => {
    const { context, cleared } = fakeContext('20008', '90001')
    const result = await ensureFacebookProfileIdentity(
      context,
      fakePage(),
      browserSettings(),
      '10007'
    )

    expect(result).toMatchObject({ status: 'needs_login', code: 'needs_login' })
    expect(cleared()).toBe(0)
  })
})
