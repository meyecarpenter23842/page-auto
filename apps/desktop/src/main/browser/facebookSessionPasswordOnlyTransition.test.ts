import type { BrowserContext, Locator, Page } from 'playwright-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootstrapFacebookSession, type FacebookSessionAccount } from './facebookSession'

type PasswordOnlyTarget = 'two_factor' | 'valid' | 'checkpoint'

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

function nameMatches(options: { name?: string | RegExp } | undefined, label: string): boolean {
  const name = options?.name
  if (name instanceof RegExp) return name.test(label)
  if (typeof name === 'string') return name.toLowerCase() === label.toLowerCase()
  return false
}

function passwordAccount(id: number, uid: string): FacebookSessionAccount {
  return {
    id,
    uid,
    username: null,
    password: 'saved-password',
    cookie: null,
    twoFactorSecret: '654321'
  }
}

function createPasswordOnlyFixture(target: PasswordOnlyTarget): {
  context: BrowserContext
  page: Page
  transitionPolls: () => number
  filledTwoFactorCode: () => string | null
} {
  let surface: 'password_only' | PasswordOnlyTarget = 'password_only'
  let currentUrl = 'https://www.facebook.com/'
  let passwordSubmitted = false
  let polls = 0
  let filledCode: string | null = null

  const isLoggedIn = (): boolean => surface === 'valid'
  const context = {
    cookies: async () => isLoggedIn()
      ? [
          { name: 'c_user', value: '70007', domain: '.facebook.com', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' },
          { name: 'xs', value: 'session-cookie', domain: '.facebook.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }
        ]
      : [],
    addCookies: async () => undefined
  } as unknown as BrowserContext

  const identifierInput = hiddenLocator()
  const passwordInput = visibleLocator({
    isVisible: async () => surface === 'password_only',
    fill: async () => undefined,
    press: async () => { passwordSubmitted = true }
  })
  const passwordSubmit = visibleLocator({
    isVisible: async () => surface === 'password_only',
    click: async () => { passwordSubmitted = true }
  })
  const otpInput = visibleLocator({
    isVisible: async () => surface === 'two_factor',
    isEnabled: async () => surface === 'two_factor',
    fill: async (value: string) => { filledCode = value },
    press: async () => undefined
  })
  const twoFactorSubmit = visibleLocator({
    isVisible: async () => surface === 'two_factor',
    isEnabled: async () => surface === 'two_factor',
    click: async () => {
      surface = 'valid'
      currentUrl = 'https://www.facebook.com/'
    }
  })
  const manualMarker = visibleLocator({ isVisible: async () => surface === 'checkpoint' })

  const moveToTarget = (): void => {
    surface = target
    if (target === 'two_factor') currentUrl = 'https://www.facebook.com/two_step_verification/two_factor/'
    else if (target === 'checkpoint') currentUrl = 'https://www.facebook.com/checkpoint/123/'
    else currentUrl = 'https://www.facebook.com/'
  }

  const page = {
    url: () => currentUrl,
    goto: async (url: string) => { currentUrl = url },
    waitForLoadState: async () => undefined,
    waitForTimeout: async (milliseconds: number) => {
      if (!passwordSubmitted || surface !== 'password_only' || milliseconds !== 250) return
      polls += 1
      if (polls >= 2) moveToTarget()
    },
    locator: (selector: string) => {
      if (selector.includes('input[name="email"]')) return identifierInput
      if (selector.includes('input[name="pass"]')) return passwordInput
      if (selector.includes('placeholder*="code"')) return otpInput
      if (selector.includes('button[type="submit"]')) {
        if (surface === 'two_factor') return twoFactorSubmit
        if (surface === 'password_only') return passwordSubmit
      }
      return hiddenLocator()
    },
    getByText: (text: string | RegExp) => {
      if (surface === 'checkpoint' && text instanceof RegExp && text.test('confirm your identity')) return manualMarker
      return hiddenLocator()
    },
    getByRole: (role: string, options?: { name?: string | RegExp }) => {
      if (role !== 'button') return hiddenLocator()
      if (surface === 'password_only' && nameMatches(options, 'Continue')) return passwordSubmit
      if (surface === 'two_factor' && nameMatches(options, 'Continue')) return twoFactorSubmit
      return hiddenLocator()
    }
  } as unknown as Page

  return {
    context,
    page,
    transitionPolls: () => polls,
    filledTwoFactorCode: () => filledCode
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('saved-profile password-only transition', () => {
  it('ignores stale password-only DOM until delayed 2FA is ready, then enters the 2FA handler', async () => {
    const fixture = createPasswordOnlyFixture('two_factor')
    const diagnostics: string[] = []
    vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      diagnostics.push(String(message ?? ''))
    })

    const result = await bootstrapFacebookSession(fixture.context, fixture.page, passwordAccount(21, '70007'), 'auto')

    expect(fixture.transitionPolls()).toBeGreaterThanOrEqual(2)
    expect(fixture.filledTwoFactorCode()).toBe('654321')
    expect(diagnostics.some((line) => line.includes('state=two_factor stage=handler_start'))).toBe(true)
    expect(result).toMatchObject({ accountId: 21, status: 'valid', reason: 'valid', cookieStatus: 'valid' })
  })

  it('accepts a delayed direct transition from password-only to a valid session', async () => {
    const fixture = createPasswordOnlyFixture('valid')

    const result = await bootstrapFacebookSession(fixture.context, fixture.page, passwordAccount(22, '70007'), 'auto')

    expect(fixture.transitionPolls()).toBeGreaterThanOrEqual(2)
    expect(fixture.filledTwoFactorCode()).toBeNull()
    expect(result).toMatchObject({ accountId: 22, status: 'valid', reason: 'valid', cookieStatus: 'valid' })
  })

  it('routes a delayed checkpoint transition to manual verification instead of declaring password failure', async () => {
    const fixture = createPasswordOnlyFixture('checkpoint')

    const result = await bootstrapFacebookSession(fixture.context, fixture.page, passwordAccount(23, '70007'), 'auto')

    expect(fixture.transitionPolls()).toBeGreaterThanOrEqual(2)
    expect(result).toMatchObject({ accountId: 23, status: 'needs_login', reason: 'checkpoint', cookieStatus: 'needs_login' })
    expect(result.message).toMatch(/checkpoint|xác minh/i)
    expect(result.message).not.toMatch(/vẫn yêu cầu password/i)
  })
})
