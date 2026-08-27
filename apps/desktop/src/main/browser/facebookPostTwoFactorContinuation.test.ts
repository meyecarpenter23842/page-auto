import { describe, expect, it } from 'vitest'
import type { BrowserContext, Locator, Page } from 'playwright-core'
import type { FacebookSessionAccount, FacebookSessionResult } from './facebookSession'
import { settleFacebookSessionAfterTwoFactor } from './facebookPostTwoFactorContinuation'

class VisibilityLocator {
  constructor(private readonly visible: boolean) {}
  first(): Locator { return this as unknown as Locator }
  nth(): Locator { return this as unknown as Locator }
  async count(): Promise<number> { return 1 }
  async isVisible(): Promise<boolean> { return this.visible }
  async isEnabled(): Promise<boolean> { return true }
}

function isManualVerificationPattern(value: string | RegExp): boolean {
  return value instanceof RegExp && value.source.includes('confirm your identity')
}

type FakeAuthGate = 'two_factor' | 'login' | 'password_only' | null

function fakePage(
  url = 'https://www.facebook.com/',
  textOnlyManualVerification = false,
  authGate: FakeAuthGate = null
): Page {
  const hidden = new VisibilityLocator(false) as unknown as Locator
  const visible = new VisibilityLocator(true) as unknown as Locator
  return {
    url: () => url,
    locator: (selector: string) => {
      if (authGate === 'two_factor' && selector.includes('approvals_code')) return visible
      if (selector.includes('input[name="email"]') || selector.includes('#email')) {
        return authGate === 'login' ? visible : hidden
      }
      if (selector.includes('input[name="pass"]') || selector.includes('#pass')) {
        return authGate === 'login' || authGate === 'password_only' ? visible : hidden
      }
      return hidden
    },
    getByText: (text: string | RegExp) => (
      textOnlyManualVerification && isManualVerificationPattern(text) ? visible : hidden
    ),
    getByRole: () => hidden,
    waitForTimeout: async () => undefined
  } as unknown as Page
}

function fakeContext(userIds: Array<string | null>): BrowserContext {
  let readIndex = 0
  return {
    cookies: async () => {
      const userId = userIds[Math.min(readIndex, userIds.length - 1)] ?? null
      readIndex += 1
      if (!userId) return []
      return [
        { name: 'c_user', value: userId, domain: '.facebook.com', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' as const },
        { name: 'xs', value: 'session-token', domain: '.facebook.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' as const }
      ]
    }
  } as unknown as BrowserContext
}

const account: FacebookSessionAccount = {
  id: 17,
  uid: '123',
  username: 'account-login',
  password: 'password',
  cookie: null,
  twoFactorSecret: '123456'
}

const transientFailure: FacebookSessionResult = {
  accountId: account.id,
  status: 'needs_login',
  reason: 'two_factor_failed',
  cookie: null,
  cookieStatus: 'needs_login',
  lastCookieCheck: 1,
  message: 'Facebook đã rời màn 2FA nhưng chưa tạo session hợp lệ.'
}

const transientCheckpoint: FacebookSessionResult = {
  accountId: account.id,
  status: 'needs_login',
  reason: 'checkpoint',
  cookie: null,
  cookieStatus: 'needs_login',
  lastCookieCheck: 1,
  message: 'Facebook yêu cầu checkpoint/xác minh danh tính sau 2FA; cần xử lý thủ công.'
}

describe('post-2FA session continuation', () => {
  it('waits for a delayed c_user, verifies the expected UID and returns fresh cookies', async () => {
    const result = await settleFacebookSessionAfterTwoFactor(
      fakeContext([null, null, null, '123', '123']),
      fakePage(),
      account,
      transientFailure,
      { attempts: 4, pollMs: 0 }
    )

    expect(result.status).toBe('valid')
    expect(result.reason).toBe('valid')
    expect(result.cookie).toContain('c_user=123')
    expect(result.cookie).toContain('xs=session-token')
  })

  it('uses the configured network timeout for a session that settles after the old 12-second window', async () => {
    const delayedCookies = [...Array.from({ length: 55 }, () => null), '123', '123']
    const result = await settleFacebookSessionAfterTwoFactor(
      fakeContext(delayedCookies),
      fakePage(),
      account,
      transientFailure,
      { timeoutMs: 30_000, pollMs: 250 }
    )

    expect(result.status).toBe('valid')
    expect(result.reason).toBe('valid')
    expect(result.cookie).toContain('c_user=123')
  })

  it('continues a text-only manual gate on Facebook home when it came directly after 2FA', async () => {
    const result = await settleFacebookSessionAfterTwoFactor(
      fakeContext([null, null, null, '123', '123']),
      fakePage('https://www.facebook.com/', true),
      account,
      transientCheckpoint,
      { attempts: 4, pollMs: 0 }
    )

    expect(result.status).toBe('valid')
    expect(result.reason).toBe('valid')
    expect(result.cookie).toContain('c_user=123')
  })

  it('keeps a text-only post-2FA manual gate as checkpoint when no valid session appears', async () => {
    const result = await settleFacebookSessionAfterTwoFactor(
      fakeContext([null]),
      fakePage('https://www.facebook.com/', true),
      account,
      transientCheckpoint,
      { attempts: 2, pollMs: 0 }
    )

    expect(result.status).toBe('needs_login')
    expect(result.reason).toBe('checkpoint')
  })

  it('does not settle an unrelated checkpoint just because it is shown on Facebook home', async () => {
    const unrelatedCheckpoint: FacebookSessionResult = {
      ...transientCheckpoint,
      message: 'Facebook yêu cầu checkpoint/xác minh danh tính; cần xử lý thủ công.'
    }
    const result = await settleFacebookSessionAfterTwoFactor(
      fakeContext(['123']),
      fakePage('https://www.facebook.com/', true),
      account,
      unrelatedCheckpoint,
      { attempts: 2, pollMs: 0 }
    )

    expect(result).toEqual(unrelatedCheckpoint)
  })

  it('does not accept a stale matching c_user while the 2FA surface is still active', async () => {
    const result = await settleFacebookSessionAfterTwoFactor(
      fakeContext(['123']),
      fakePage('https://www.facebook.com/two_step_verification/', false, 'two_factor'),
      account,
      transientFailure,
      { attempts: 2, pollMs: 0 }
    )

    expect(result).toEqual(transientFailure)
  })

  it('does not accept a stale matching c_user while a login surface is active', async () => {
    const result = await settleFacebookSessionAfterTwoFactor(
      fakeContext(['123']),
      fakePage('https://www.facebook.com/', false, 'login'),
      account,
      transientFailure,
      { attempts: 2, pollMs: 0 }
    )

    expect(result).toEqual(transientFailure)
  })

  it('does not accept a stale matching c_user while a password-only surface is active', async () => {
    const result = await settleFacebookSessionAfterTwoFactor(
      fakeContext(['123']),
      fakePage('https://www.facebook.com/', false, 'password_only'),
      account,
      transientFailure,
      { attempts: 2, pollMs: 0 }
    )

    expect(result).toEqual(transientFailure)
  })

  it('rejects a delayed post-2FA session that belongs to another numeric UID', async () => {
    const result = await settleFacebookSessionAfterTwoFactor(
      fakeContext([null, null, '999', '999']),
      fakePage(),
      account,
      transientFailure,
      { attempts: 4, pollMs: 0 }
    )

    expect(result.status).toBe('needs_login')
    expect(result.reason).toBe('login_failed')
    expect(result.cookie).toBeNull()
    expect(result.message).toContain('không khớp account UID 123')
  })

  it('converts an explicit checkpoint URL reached after 2FA into the Common manual-verification result', async () => {
    const result = await settleFacebookSessionAfterTwoFactor(
      fakeContext([null]),
      fakePage('https://www.facebook.com/checkpoint/'),
      account,
      transientFailure,
      { attempts: 2, pollMs: 0 }
    )

    expect(result.status).toBe('needs_login')
    expect(result.reason).toBe('checkpoint')
    expect(result.message).toContain('xác minh danh tính sau 2FA')
  })
})
