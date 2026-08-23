import type { BrowserContext, Locator, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { bootstrapFacebookSession, type FacebookSessionAccount } from './facebookSession'

function hiddenLocator(): Locator {
  const stub: Partial<Locator> = {
    first: () => stub as Locator,
    isVisible: async () => false
  }
  return stub as Locator
}

describe('Facebook 2FA bootstrap flow', () => {
  it('detects authenticator input, fills account 2FA code, submits, then verifies c_user session', async () => {
    let loggedIn = false
    let currentUrl = 'https://www.facebook.com/checkpoint/123/'
    let filledCode: string | null = null
    let submitted = 0

    const otpInput: Partial<Locator> = {
      first: () => otpInput as Locator,
      isVisible: async () => !loggedIn,
      fill: async (value: string) => { filledCode = value },
      press: async () => { submitted += 1; loggedIn = true; currentUrl = 'https://www.facebook.com/' }
    }
    const submitButton: Partial<Locator> = {
      first: () => submitButton as Locator,
      isVisible: async () => !loggedIn,
      click: async () => { submitted += 1; loggedIn = true; currentUrl = 'https://www.facebook.com/' }
    }

    const page = {
      url: () => currentUrl,
      goto: async () => { currentUrl = 'https://www.facebook.com/checkpoint/123/' },
      waitForTimeout: async () => undefined,
      waitForLoadState: async () => undefined,
      locator: (selector: string) => {
        if (selector.includes('approvals_code')) return otpInput as Locator
        if (selector.includes('button[type="submit"]')) return submitButton as Locator
        return hiddenLocator()
      },
      getByText: () => hiddenLocator(),
      getByRole: (role: string) => role === 'button' ? submitButton as Locator : hiddenLocator()
    } as unknown as Page

    const context = {
      cookies: async () => loggedIn
        ? [
            { name: 'c_user', value: '10001', domain: '.facebook.com', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' },
            { name: 'xs', value: 'session-cookie', domain: '.facebook.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }
          ]
        : [],
      addCookies: async () => undefined
    } as unknown as BrowserContext

    const account: FacebookSessionAccount = {
      id: 7,
      uid: '10001',
      username: null,
      password: null,
      cookie: null,
      twoFactorSecret: '123456'
    }

    const result = await bootstrapFacebookSession(context, page, account, 'auto')

    expect(filledCode).toBe('123456')
    expect(submitted).toBe(1)
    expect(result).toMatchObject({ accountId: 7, status: 'valid', reason: 'valid', cookieStatus: 'valid' })
    expect(result.cookie).toContain('c_user=10001')
  })
})