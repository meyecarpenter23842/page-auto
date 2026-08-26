import { describe, expect, it } from 'vitest'
import type { BrowserContext, Locator, Page } from 'playwright-core'
import {
  bootstrapFacebookSession,
  canUseStoredFacebookCookies,
  classifyFacebookSessionGate,
  facebookUserIdMatchesExpected,
  generateTotp,
  parseFacebookCookies,
  resolveTwoFactorCode,
  storedFacebookCookieUserId,
  type FacebookSessionAccount
} from './facebookSession'

describe('parseFacebookCookies', () => {
  it('parses header-style Facebook cookies without losing values containing equals', () => {
    const cookies = parseFacebookCookies('c_user=123; xs=abc==; fr=hello')
    expect(cookies.map((cookie) => [cookie.name, cookie.value])).toEqual([
      ['c_user', '123'],
      ['xs', 'abc=='],
      ['fr', 'hello']
    ])
    expect(cookies.every((cookie) => cookie.domain === '.facebook.com')).toBe(true)
  })

  it('parses JSON cookie exports and normalizes SameSite', () => {
    const cookies = parseFacebookCookies(JSON.stringify([
      { name: 'c_user', value: '42', domain: '.facebook.com', path: '/', sameSite: 'no_restriction', secure: true }
    ]))
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toMatchObject({ name: 'c_user', value: '42', sameSite: 'None', secure: true })
  })

  it('uses a saved cookie only when c_user is present and matches a numeric UID', () => {
    expect(storedFacebookCookieUserId('xs=abc; c_user=123; fr=x')).toBe('123')
    expect(canUseStoredFacebookCookies('c_user=123; xs=abc', '123')).toBe(true)
    expect(canUseStoredFacebookCookies('c_user=999; xs=abc', '123')).toBe(false)
    expect(canUseStoredFacebookCookies('xs=abc', '123')).toBe(false)
    expect(canUseStoredFacebookCookies('c_user=999; xs=abc', 'username.login')).toBe(true)
  })

  it('verifies numeric account identity but allows username-based accounts when a c_user exists', () => {
    expect(facebookUserIdMatchesExpected('123', '123')).toBe(true)
    expect(facebookUserIdMatchesExpected('999', '123')).toBe(false)
    expect(facebookUserIdMatchesExpected('999', 'username.login')).toBe(true)
    expect(facebookUserIdMatchesExpected(null, '123')).toBe(false)
  })
})

describe('generateTotp', () => {
  it('matches the RFC 6238 SHA-1 test secret reduced to six digits', () => {
    expect(generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000, 6)).toBe('287082')
  })

  it('accepts otpauth URLs and preserves an already-resolved direct code', () => {
    expect(generateTotp('otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000, 6)).toBe('287082')
    expect(resolveTwoFactorCode(' 123 456 ')).toBe('123456')
  })
})

describe('saved-profile session gates', () => {
  it('does not treat /login/ URL alone as a credential form', () => {
    expect(classifyFacebookSessionGate({
      url: 'https://www.facebook.com/login/',
      hasUserCookie: false,
      loginFormVisible: false,
      twoFactorVisible: false,
      manualVerificationTextVisible: false
    })).toBe('unknown')
  })

  it('classifies saved-profile Continue and password-only as explicit states', () => {
    expect(classifyFacebookSessionGate({
      url: 'https://www.facebook.com/login/',
      hasUserCookie: false,
      loginFormVisible: false,
      savedProfileVisible: true,
      twoFactorVisible: false,
      manualVerificationTextVisible: false
    })).toBe('saved_profile')

    expect(classifyFacebookSessionGate({
      url: 'https://www.facebook.com/login/',
      hasUserCookie: false,
      loginFormVisible: false,
      savedProfileVisible: true,
      passwordOnlyVisible: true,
      twoFactorVisible: false,
      manualVerificationTextVisible: false
    })).toBe('password_only')
  })
})

type LoginOutcome = 'success' | 'two_factor' | 'mismatch'
type EntryMode = 'login' | 'saved_profile'
type FakeMode = 'home' | 'login' | 'saved_profile' | 'password_only' | 'two_factor' | 'valid'

interface FakeFacebookOptions {
  entryMode?: EntryMode
  savedProfileRequiresPassword?: boolean
  initialCUser?: string | null
}

class FakeLocator {
  constructor(
    private readonly visible: () => boolean,
    private readonly onFill: (value: string) => void = () => undefined,
    private readonly onClick: () => void = () => undefined,
    private readonly onPress: (key: string) => void = () => undefined
  ) {}

  first(): Locator { return this as unknown as Locator }
  nth(): Locator { return this as unknown as Locator }
  async count(): Promise<number> { return 1 }
  async isVisible(): Promise<boolean> { return this.visible() }
  async isEnabled(): Promise<boolean> { return true }
  async fill(value: string): Promise<void> { this.onFill(value) }
  async scrollIntoViewIfNeeded(): Promise<void> {}
  async click(): Promise<void> { this.onClick() }
  async press(key: string): Promise<void> { this.onPress(key) }
}

function accessibleNameMatches(expected: unknown, actual: string): boolean {
  if (expected instanceof RegExp) {
    expected.lastIndex = 0
    return expected.test(actual)
  }
  return typeof expected === 'string' && expected === actual
}

function fakeFacebook(outcome: LoginOutcome, expectedUid = '123', options: FakeFacebookOptions = {}): {
  context: BrowserContext
  page: Page
  visits: string[]
  submitted: {
    identifier: string
    password: string
    twoFactor: string
    savedProfileContinue: number
    useAnotherProfile: number
  }
} {
  let mode: FakeMode = 'home'
  let currentUrl = 'about:blank'
  let cUser: string | null = options.initialCUser ?? null
  const visits: string[] = []
  const submitted = {
    identifier: '',
    password: '',
    twoFactor: '',
    savedProfileContinue: 0,
    useAnotherProfile: 0
  }

  const finishLogin = (): void => {
    if (outcome === 'two_factor') {
      mode = 'two_factor'
      currentUrl = 'https://www.facebook.com/two_step_verification/'
      return
    }
    cUser = outcome === 'mismatch' ? '999' : expectedUid
    mode = 'valid'
    currentUrl = 'https://www.facebook.com/'
  }

  const finishTwoFactor = (): void => {
    cUser = expectedUid
    mode = 'valid'
    currentUrl = 'https://www.facebook.com/'
  }

  const continueSavedProfile = (): void => {
    submitted.savedProfileContinue += 1
    if (options.savedProfileRequiresPassword) {
      mode = 'password_only'
      currentUrl = 'https://www.facebook.com/login/device-based/validate-password/'
      return
    }
    finishLogin()
  }

  const useAnotherProfile = (): void => {
    submitted.useAnotherProfile += 1
    mode = 'login'
    currentUrl = 'https://www.facebook.com/login/'
  }

  const locator = (selector: string): Locator => {
    if (selector.includes('input[name="email"]') || selector === '#email') {
      return new FakeLocator(() => mode === 'login', (value) => { submitted.identifier = value }) as unknown as Locator
    }
    if (selector.includes('input[name="pass"]') || selector === '#pass') {
      return new FakeLocator(
        () => mode === 'login' || mode === 'password_only',
        (value) => { submitted.password = value },
        () => undefined,
        (key) => { if (key === 'Enter') finishLogin() }
      ) as unknown as Locator
    }
    if (selector.includes('approvals_code') || selector.includes('approvalsCode')) {
      return new FakeLocator(() => mode === 'two_factor', (value) => { submitted.twoFactor = value }) as unknown as Locator
    }
    if (selector.includes('button[name="login"]')) {
      return new FakeLocator(() => mode === 'login', () => undefined, finishLogin) as unknown as Locator
    }
    if (selector.includes('button[type="submit"]') || selector.includes('input[type="submit"]')) {
      return new FakeLocator(
        () => mode === 'two_factor' || mode === 'password_only',
        () => undefined,
        () => { if (mode === 'two_factor') finishTwoFactor(); else finishLogin() }
      ) as unknown as Locator
    }
    return new FakeLocator(() => false) as unknown as Locator
  }

  const roleLocator = (role: string, roleOptions?: { name?: string | RegExp }): Locator => {
    const name = roleOptions?.name
    if (role === 'button' && accessibleNameMatches(name, 'Continue')) {
      return new FakeLocator(
        () => mode === 'saved_profile' || mode === 'password_only' || mode === 'two_factor',
        () => undefined,
        () => {
          if (mode === 'saved_profile') continueSavedProfile()
          else if (mode === 'password_only') finishLogin()
          else if (mode === 'two_factor') finishTwoFactor()
        }
      ) as unknown as Locator
    }
    if (role === 'button' && accessibleNameMatches(name, 'Use another profile')) {
      return new FakeLocator(() => mode === 'saved_profile', () => undefined, useAnotherProfile) as unknown as Locator
    }
    if (role === 'button' && accessibleNameMatches(name, 'Log in')) {
      return new FakeLocator(() => mode === 'login', () => undefined, finishLogin) as unknown as Locator
    }
    return new FakeLocator(() => false) as unknown as Locator
  }

  const textLocator = (text: string | RegExp): Locator => {
    if (accessibleNameMatches(text, 'Use another profile')) {
      return new FakeLocator(() => mode === 'saved_profile', () => undefined, useAnotherProfile) as unknown as Locator
    }
    if (accessibleNameMatches(text, 'Continue')) {
      return new FakeLocator(() => mode === 'saved_profile', () => undefined, continueSavedProfile) as unknown as Locator
    }
    return new FakeLocator(() => false) as unknown as Locator
  }

  const page = {
    url: () => currentUrl,
    goto: async (url: string) => {
      visits.push(url)
      currentUrl = url
      if (url.includes('/login/')) mode = options.entryMode ?? 'login'
      else mode = 'home'
      return null
    },
    waitForTimeout: async () => undefined,
    waitForLoadState: async () => undefined,
    locator,
    getByText: (text: string | RegExp) => textLocator(text),
    getByRole: (role: string, roleOptions?: { name?: string | RegExp }) => roleLocator(role, roleOptions)
  } as unknown as Page

  const context = {
    cookies: async () => cUser
      ? [{ name: 'c_user', value: cUser, domain: '.facebook.com', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' as const }]
      : [],
    addCookies: async (cookies: Array<{ name: string; value: string }>) => {
      const user = cookies.find((cookie) => cookie.name === 'c_user')
      if (user) cUser = user.value
    }
  } as unknown as BrowserContext

  return { context, page, visits, submitted }
}

const account: FacebookSessionAccount = {
  id: 7,
  uid: '123',
  username: 'account-login',
  password: 'secret-password',
  cookie: null,
  twoFactorSecret: null
}

describe('bootstrapFacebookSession recovery priority', () => {
  it('prefers a matching stored cookie before opening interactive login', async () => {
    const fake = fakeFacebook('success', '123', { entryMode: 'saved_profile' })
    const result = await bootstrapFacebookSession(fake.context, fake.page, {
      ...account,
      cookie: 'c_user=123; xs=saved-cookie'
    })

    expect(fake.visits).toEqual(['https://www.facebook.com/'])
    expect(fake.submitted.savedProfileContinue).toBe(0)
    expect(fake.submitted.identifier).toBe('')
    expect(result.status).toBe('valid')
    expect(result.cookie).toContain('c_user=123')
  })

  it('lets a matching stored cookie replace a mismatched persistent c_user for a numeric account', async () => {
    const fake = fakeFacebook('success', '123', { initialCUser: '999', entryMode: 'saved_profile' })
    const result = await bootstrapFacebookSession(fake.context, fake.page, {
      ...account,
      cookie: 'c_user=123; xs=saved-cookie'
    })

    expect(fake.visits).toEqual(['https://www.facebook.com/'])
    expect(fake.submitted.savedProfileContinue).toBe(0)
    expect(result.status).toBe('valid')
    expect(result.cookie).toContain('c_user=123')
  })
})

describe('bootstrapFacebookSession credential fallback', () => {
  it('recovers logged-out home unknown state by opening the explicit login page and submitting credentials', async () => {
    const fake = fakeFacebook('success')
    const result = await bootstrapFacebookSession(fake.context, fake.page, account)

    expect(fake.visits).toEqual(['https://www.facebook.com/', 'https://www.facebook.com/login/'])
    expect(fake.submitted.identifier).toBe('account-login')
    expect(fake.submitted.password).toBe('secret-password')
    expect(result.status).toBe('valid')
    expect(result.cookie).toContain('c_user=123')
  })

  it('continues a remembered Facebook profile before falling back to credentials', async () => {
    const fake = fakeFacebook('success', '123', { entryMode: 'saved_profile' })
    const result = await bootstrapFacebookSession(fake.context, fake.page, {
      ...account,
      password: null
    })

    expect(fake.visits).toEqual(['https://www.facebook.com/', 'https://www.facebook.com/login/'])
    expect(fake.submitted.savedProfileContinue).toBe(1)
    expect(fake.submitted.identifier).toBe('')
    expect(fake.submitted.password).toBe('')
    expect(result.status).toBe('valid')
    expect(result.cookie).toContain('c_user=123')
  })

  it('handles saved-profile Continue followed by a password-only screen', async () => {
    const fake = fakeFacebook('success', '123', {
      entryMode: 'saved_profile',
      savedProfileRequiresPassword: true
    })
    const result = await bootstrapFacebookSession(fake.context, fake.page, account)

    expect(fake.submitted.savedProfileContinue).toBe(1)
    expect(fake.submitted.identifier).toBe('')
    expect(fake.submitted.password).toBe('secret-password')
    expect(result.status).toBe('valid')
    expect(result.cookie).toContain('c_user=123')
  })

  it('keeps the existing 2FA flow after explicit-login fallback and verifies the final UID', async () => {
    const fake = fakeFacebook('two_factor')
    const result = await bootstrapFacebookSession(fake.context, fake.page, {
      ...account,
      twoFactorSecret: '123456'
    })

    expect(fake.submitted.twoFactor).toBe('123456')
    expect(result.status).toBe('valid')
    expect(result.cookie).toContain('c_user=123')
  })

  it('rejects a saved-profile Continue that produces a c_user for a different numeric account', async () => {
    const fake = fakeFacebook('mismatch', '123', { entryMode: 'saved_profile' })
    const result = await bootstrapFacebookSession(fake.context, fake.page, account)

    expect(fake.submitted.savedProfileContinue).toBe(1)
    expect(result.status).toBe('needs_login')
    expect(result.reason).toBe('login_failed')
    expect(result.message).toContain('không khớp account UID 123')
  })

  it('rejects a credential login that produces a c_user for a different numeric account', async () => {
    const fake = fakeFacebook('mismatch')
    const result = await bootstrapFacebookSession(fake.context, fake.page, account)

    expect(result.status).toBe('needs_login')
    expect(result.reason).toBe('login_failed')
    expect(result.message).toContain('không khớp account UID 123')
  })
})