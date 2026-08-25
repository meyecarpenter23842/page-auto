import type { BrowserContext, Locator, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import {
  bootstrapFacebookSession,
  classifyFacebookSessionGate,
  twoFactorCodeFreshnessWaitMs,
  type FacebookSessionAccount
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

function multiLocator(items: Locator[]): Locator {
  const stub: Partial<Locator> = {
    first: () => items[0] ?? hiddenLocator(),
    last: () => items.at(-1) ?? hiddenLocator(),
    nth: (index: number) => items[index] ?? hiddenLocator(),
    count: async () => items.length,
    isVisible: async () => Boolean(items[0] && await items[0].isVisible()),
    isEnabled: async () => Boolean(items[0] && await items[0].isEnabled())
  }
  return stub as Locator
}

function sessionContext(uid: string, loggedIn: () => boolean): BrowserContext {
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

function account(id: number, uid: string, twoFactorSecret: string): FacebookSessionAccount {
  return { id, uid, username: null, password: null, cookie: null, twoFactorSecret }
}

describe('Facebook 2FA bootstrap flow', () => {
  it('detects authenticator input, fills account 2FA code, submits, then verifies c_user session', async () => {
    let loggedIn = false
    let currentUrl = 'https://www.facebook.com/checkpoint/123/'
    let filledCode: string | null = null
    let submitted = 0

    const otpInput = visibleLocator({
      isVisible: async () => !loggedIn,
      fill: async (value: string) => { filledCode = value },
      press: async () => { submitted += 1; loggedIn = true; currentUrl = 'https://www.facebook.com/' }
    })
    const submitButton = visibleLocator({
      isVisible: async () => !loggedIn,
      click: async () => { submitted += 1; loggedIn = true; currentUrl = 'https://www.facebook.com/' }
    })

    const page = {
      url: () => currentUrl,
      goto: async () => { currentUrl = loggedIn ? 'https://www.facebook.com/' : 'https://www.facebook.com/checkpoint/123/' },
      waitForTimeout: async () => undefined,
      waitForLoadState: async () => undefined,
      locator: (selector: string) => {
        if (selector.includes('approvals_code')) return otpInput
        if (selector.includes('button[type="submit"]')) return submitButton
        return hiddenLocator()
      },
      getByText: () => hiddenLocator(),
      getByRole: (role: string) => role === 'button' ? submitButton : hiddenLocator()
    } as unknown as Page

    const result = await bootstrapFacebookSession(sessionContext('10001', () => loggedIn), page, account(7, '10001', '123456'), 'auto')

    expect(filledCode).toBe('123456')
    expect(submitted).toBe(1)
    expect(result).toMatchObject({ accountId: 7, status: 'valid', reason: 'valid', cookieStatus: 'valid' })
    expect(result.cookie).toContain('c_user=10001')
  })

  it('waits for Facebook to leave the 2FA screen instead of failing on the first still-visible poll after Continue', async () => {
    const twoFactorUrl = 'https://www.facebook.com/two_step_verification/two_factor/'
    let loggedIn = false
    let currentUrl = twoFactorUrl
    let submitted = false
    let waitsAfterSubmit = 0

    const otpInput = visibleLocator({
      isVisible: async () => !loggedIn,
      fill: async () => undefined,
      press: async () => undefined
    })
    const submitButton = visibleLocator({
      isVisible: async () => !loggedIn,
      click: async () => { submitted = true }
    })

    const page = {
      url: () => currentUrl,
      goto: async () => { currentUrl = loggedIn ? 'https://www.facebook.com/' : twoFactorUrl },
      waitForTimeout: async () => {
        if (!submitted || loggedIn) return
        waitsAfterSubmit += 1
        if (waitsAfterSubmit >= 2) {
          loggedIn = true
          currentUrl = 'https://www.facebook.com/'
        }
      },
      waitForLoadState: async () => undefined,
      locator: (selector: string) => selector.includes('placeholder*="code"') ? otpInput : hiddenLocator(),
      getByText: () => hiddenLocator(),
      getByRole: (role: string) => role === 'button' ? submitButton : hiddenLocator()
    } as unknown as Page

    const result = await bootstrapFacebookSession(sessionContext('40004', () => loggedIn), page, account(10, '40004', '444555'), 'auto')

    expect(submitted).toBe(true)
    expect(waitsAfterSubmit).toBeGreaterThanOrEqual(2)
    expect(result).toMatchObject({ accountId: 10, status: 'valid', reason: 'valid', cookieStatus: 'valid' })
  })

  it('waits for a fresh generated TOTP window near expiry but never delays a direct code', () => {
    expect(twoFactorCodeFreshnessWaitMs('123456', 29_000)).toBe(0)
    expect(twoFactorCodeFreshnessWaitMs('JBSWY3DPEHPK3PXP', 10_000)).toBe(0)
    expect(twoFactorCodeFreshnessWaitMs('JBSWY3DPEHPK3PXP', 29_000)).toBe(1_750)
  })

  it('does not classify two_step_verification as manual checkpoint while the 2FA input is still rendering', () => {
    expect(classifyFacebookSessionGate({
      url: 'https://www.facebook.com/two_step_verification/two_factor/authentication/',
      hasUserCookie: false,
      loginFormVisible: false,
      passwordOnlyVisible: false,
      savedProfileVisible: false,
      twoFactorVisible: false,
      manualVerificationTextVisible: false
    })).toBe('unknown')
  })

  it('fills the current Facebook generic Code field and clicks the visible Continue candidate even when another candidate is hidden', async () => {
    const twoFactorUrl = 'https://www.facebook.com/two_step_verification/two_factor/authentication/'
    let loggedIn = false
    let currentUrl = twoFactorUrl
    let filledCode: string | null = null
    let submitted = 0

    const otpInput = visibleLocator({
      isVisible: async () => !loggedIn,
      fill: async (value: string) => { filledCode = value },
      press: async () => { submitted += 1; loggedIn = true; currentUrl = 'https://www.facebook.com/' }
    })
    const hiddenSubmit = visibleLocator({ isVisible: async () => false })
    const visibleSubmit = visibleLocator({
      isVisible: async () => !loggedIn,
      click: async () => { submitted += 1; loggedIn = true; currentUrl = 'https://www.facebook.com/' }
    })
    const submitCandidates = multiLocator([hiddenSubmit, visibleSubmit])

    const page = {
      url: () => currentUrl,
      goto: async () => { currentUrl = loggedIn ? 'https://www.facebook.com/' : twoFactorUrl },
      waitForTimeout: async () => undefined,
      waitForLoadState: async () => undefined,
      locator: (selector: string) => {
        if (selector.includes('placeholder*="code"')) return otpInput
        if (selector.includes('button[type="submit"]')) return hiddenLocator()
        return hiddenLocator()
      },
      getByText: () => hiddenLocator(),
      getByRole: (role: string) => role === 'button' ? submitCandidates : hiddenLocator()
    } as unknown as Page

    const result = await bootstrapFacebookSession(sessionContext('20002', () => loggedIn), page, account(8, '20002', '654321'), 'auto')

    expect(filledCode).toBe('654321')
    expect(submitted).toBe(1)
    expect(result).toMatchObject({ accountId: 8, status: 'valid', reason: 'valid', cookieStatus: 'valid' })
  })

  it('falls back to DOM click when Facebook Continue rejects the Playwright click', async () => {
    const twoFactorUrl = 'https://www.facebook.com/two_step_verification/two_factor/authentication/'
    let loggedIn = false
    let currentUrl = twoFactorUrl
    let domClicks = 0

    const otpInput = visibleLocator({
      isVisible: async () => !loggedIn,
      fill: async () => undefined,
      press: async () => undefined
    })
    const submitButton = visibleLocator({
      isVisible: async () => !loggedIn,
      click: async () => { throw new Error('intercepted') },
      evaluate: async () => { domClicks += 1; loggedIn = true; currentUrl = 'https://www.facebook.com/'; return true }
    })

    const page = {
      url: () => currentUrl,
      goto: async () => { currentUrl = loggedIn ? 'https://www.facebook.com/' : twoFactorUrl },
      waitForTimeout: async () => undefined,
      waitForLoadState: async () => undefined,
      locator: (selector: string) => selector.includes('placeholder*="code"') ? otpInput : hiddenLocator(),
      getByText: () => hiddenLocator(),
      getByRole: (role: string) => role === 'button' ? submitButton : hiddenLocator()
    } as unknown as Page

    const result = await bootstrapFacebookSession(sessionContext('30003', () => loggedIn), page, account(9, '30003', '111222'), 'auto')

    expect(domClicks).toBe(1)
    expect(result).toMatchObject({ accountId: 9, status: 'valid', reason: 'valid', cookieStatus: 'valid' })
  })
})
