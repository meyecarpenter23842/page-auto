import type { BrowserContext, Locator, Page } from 'playwright-core'
import { describe, expect, it, vi } from 'vitest'
import {
  bootstrapFacebookSession,
  type FacebookSessionAccount,
  type FacebookSessionTiming
} from './facebookSession'

function hiddenLocator(): Locator {
  const stub: Partial<Locator> = {
    first: () => stub as Locator,
    last: () => stub as Locator,
    nth: () => stub as Locator,
    count: async () => 0,
    isVisible: async () => false,
    isEnabled: async () => false
  }
  return stub as Locator
}

function visibleLocator(overrides: Partial<Locator> = {}): Locator {
  const stub: Partial<Locator> = {
    first: () => stub as Locator,
    last: () => stub as Locator,
    nth: () => stub as Locator,
    count: async () => 1,
    isVisible: async () => true,
    isEnabled: async () => true,
    scrollIntoViewIfNeeded: async () => undefined,
    ...overrides
  }
  return stub as Locator
}

function contextFor(uid: string, loggedIn: () => boolean): BrowserContext {
  return {
    cookies: async () => loggedIn()
      ? [
          { name: 'c_user', value: uid, domain: '.facebook.com', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' },
          { name: 'xs', value: 'session-cookie', domain: '.facebook.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }
        ]
      : [],
    addCookies: async () => undefined
  } as unknown as BrowserContext
}

const timing: FacebookSessionTiming = {
  networkTimeoutMs: 30_000,
  navigationTimeoutMs: 45_000,
  pageSettleDelayMs: 0
}

const account: FacebookSessionAccount = {
  id: 71,
  uid: '12345',
  username: 'slow-network-user',
  password: 'test-password',
  cookie: null,
  twoFactorSecret: null
}

describe('Facebook session slow-network timing', () => {
  it('waits past the old 12-second login-surface window while keeping navigation on its own timeout', async () => {
    let clock = 0
    let currentUrl = 'https://www.facebook.com/'
    let loginSurfaceReady = false
    let loggedIn = false
    let loginSubmitted = false
    const navigationTimeouts: number[] = []
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)

    const hidden = hiddenLocator()
    const emailInput = visibleLocator({
      isVisible: async () => loginSurfaceReady && !loggedIn,
      fill: async () => undefined
    })
    const passwordInput = visibleLocator({
      isVisible: async () => loginSurfaceReady && !loggedIn,
      fill: async () => undefined,
      press: async () => {
        loginSubmitted = true
        loggedIn = true
        currentUrl = 'https://www.facebook.com/'
      }
    })
    const loginButton = visibleLocator({
      isVisible: async () => loginSurfaceReady && !loggedIn,
      click: async () => {
        loginSubmitted = true
        loggedIn = true
        currentUrl = 'https://www.facebook.com/'
      }
    })

    const page = {
      url: () => currentUrl,
      goto: async (url: string, options?: { timeout?: number }) => {
        currentUrl = url
        if (typeof options?.timeout === 'number') navigationTimeouts.push(options.timeout)
      },
      waitForTimeout: async (milliseconds: number) => {
        clock += milliseconds
        if (currentUrl.includes('/login/') && clock >= 15_000) loginSurfaceReady = true
      },
      waitForLoadState: async () => undefined,
      locator: (selector: string) => {
        if (selector.includes('input[name="email"]') || selector.includes('#email')) return emailInput
        if (selector.includes('input[name="pass"]') || selector.includes('#pass')) return passwordInput
        if (selector.includes('button[name="login"]')) return loginButton
        return hidden
      },
      getByText: () => hidden,
      getByRole: (role: string, options?: { name?: string | RegExp }) => {
        const name = options?.name
        if (role === 'button' && name instanceof RegExp && name.source.includes('log in')) return loginButton
        return hidden
      }
    } as unknown as Page

    try {
      const result = await bootstrapFacebookSession(
        contextFor(account.uid, () => loggedIn),
        page,
        account,
        'auto',
        timing
      )

      expect(loginSubmitted).toBe(true)
      expect(clock).toBeGreaterThanOrEqual(15_000)
      expect(navigationTimeouts.length).toBeGreaterThanOrEqual(2)
      expect(navigationTimeouts.every((timeout) => timeout === timing.navigationTimeoutMs)).toBe(true)
      expect(result).toMatchObject({ accountId: account.id, status: 'valid', reason: 'valid', cookieStatus: 'valid' })
      expect(result.cookie).toContain(`c_user=${account.uid}`)
    } finally {
      nowSpy.mockRestore()
    }
  })
})
