import type { BrowserContext, Locator, Page } from 'playwright-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootstrapFacebookSession, type FacebookSessionAccount } from './facebookSession'

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

function roleLocatorForContinue(submit: Locator, role: string, options?: { name?: string | RegExp }): Locator {
  if (role !== 'button') return hiddenLocator()
  const name = options?.name
  if (name instanceof RegExp && name.test('Continue')) return submit
  if (typeof name === 'string' && /^continue$/i.test(name)) return submit
  return hiddenLocator()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Facebook 2FA state-driven flow', () => {
  it('stays on the two_step_verification route until the Code input is actually ready', async () => {
    const twoFactorUrl = 'https://www.facebook.com/two_step_verification/two_factor/'
    let loggedIn = false
    let currentUrl = twoFactorUrl
    let inputChecks = 0
    let filledCode: string | null = null
    let submitted = 0
    const gotoUrls: string[] = []

    const otpInput = visibleLocator({
      isVisible: async () => {
        inputChecks += 1
        return inputChecks >= 3 && !loggedIn
      },
      isEnabled: async () => inputChecks >= 3 && !loggedIn,
      fill: async (value: string) => { filledCode = value },
      press: async () => undefined
    })
    const submitButton = visibleLocator({
      isVisible: async () => !loggedIn,
      isEnabled: async () => !loggedIn,
      click: async () => {
        submitted += 1
        loggedIn = true
        currentUrl = 'https://www.facebook.com/'
      }
    })

    const page = {
      url: () => currentUrl,
      goto: async (url: string) => {
        gotoUrls.push(url)
        currentUrl = loggedIn ? 'https://www.facebook.com/' : twoFactorUrl
      },
      waitForTimeout: async () => undefined,
      waitForLoadState: async () => undefined,
      locator: (selector: string) => selector.includes('placeholder*="code"') ? otpInput : hiddenLocator(),
      getByText: () => hiddenLocator(),
      getByRole: (role: string, options?: { name?: string | RegExp }) => roleLocatorForContinue(submitButton, role, options)
    } as unknown as Page

    const result = await bootstrapFacebookSession(sessionContext('40004', () => loggedIn), page, account(10, '40004', '444555'), 'auto')

    expect(inputChecks).toBeGreaterThanOrEqual(3)
    expect(filledCode).toBe('444555')
    expect(submitted).toBe(1)
    expect(gotoUrls).toEqual(['https://www.facebook.com/'])
    expect(result).toMatchObject({ accountId: 10, status: 'valid', reason: 'valid', cookieStatus: 'valid' })
  })

  it('uses a new generated TOTP for the second attempt when Facebook keeps the first attempt on 2FA', async () => {
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    const twoFactorUrl = 'https://www.facebook.com/two_step_verification/two_factor/'
    let loggedIn = false
    let currentUrl = twoFactorUrl
    let submitted = 0
    const filledCodes: string[] = []

    const otpInput = visibleLocator({
      isVisible: async () => !loggedIn,
      isEnabled: async () => !loggedIn,
      fill: async (value: string) => { filledCodes.push(value) },
      press: async () => undefined
    })
    const submitButton = visibleLocator({
      isVisible: async () => !loggedIn,
      isEnabled: async () => !loggedIn,
      click: async () => {
        submitted += 1
        if (submitted >= 2) {
          loggedIn = true
          currentUrl = 'https://www.facebook.com/'
        }
      }
    })

    const page = {
      url: () => currentUrl,
      goto: async () => { currentUrl = loggedIn ? 'https://www.facebook.com/' : twoFactorUrl },
      waitForTimeout: async (milliseconds: number) => { now += milliseconds },
      waitForLoadState: async () => undefined,
      locator: (selector: string) => selector.includes('placeholder*="code"') ? otpInput : hiddenLocator(),
      getByText: () => hiddenLocator(),
      getByRole: (role: string, options?: { name?: string | RegExp }) => roleLocatorForContinue(submitButton, role, options)
    } as unknown as Page

    const result = await bootstrapFacebookSession(
      sessionContext('50005', () => loggedIn),
      page,
      account(11, '50005', 'JBSWY3DPEHPK3PXP'),
      'auto'
    )

    expect(submitted).toBe(2)
    expect(filledCodes).toHaveLength(2)
    expect(filledCodes[0]).not.toBe(filledCodes[1])
    expect(result).toMatchObject({ accountId: 11, status: 'valid', reason: 'valid', cookieStatus: 'valid' })
  })
})
