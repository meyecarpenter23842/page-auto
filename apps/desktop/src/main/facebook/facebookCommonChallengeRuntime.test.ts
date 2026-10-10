import type { BrowserContext, Page } from 'playwright-core'
import { describe, expect, it, vi } from 'vitest'
import type { EmailCodeProvider } from '../../shared/emailCode'
import type { FacebookSessionResult } from '../browser/facebookSession'
import {
  runFacebookCommonChallengeRuntime,
  type FacebookCommonChallengeRuntimeDependencies
} from './facebookCommonChallengeRuntime'

const context = {} as BrowserContext
const page = {} as Page
const account = {
  id: 7,
  uid: '123456',
  username: null,
  password: 'secret',
  cookie: null,
  twoFactorSecret: 'JBSWY3DPEHPK3PXP'
}

function validSession(): FacebookSessionResult {
  return {
    accountId: 7,
    status: 'valid',
    reason: 'valid',
    cookie: 'c_user=123456',
    cookieStatus: 'valid',
    lastCookieCheck: Date.now(),
    message: 'valid'
  }
}

function input(provider: EmailCodeProvider | null = null) {
  return {
    context,
    page,
    account,
    locale: 'auto' as const,
    emailCodeProvider: provider
  }
}

function deps(overrides: Partial<FacebookCommonChallengeRuntimeDependencies> = {}): Partial<FacebookCommonChallengeRuntimeDependencies> {
  return {
    inspectChallenge: vi.fn(async () => ({ type: 'checkpoint_cleared' as const })),
    bootstrapSession: vi.fn(async () => validSession()),
    inspectIdentity: vi.fn(async () => ({
      state: 'match' as const,
      expectedUserId: '123456',
      currentUserId: '123456',
      message: 'match'
    })),
    completeEmailChallenge: vi.fn(async () => ({ status: 'success' as const, message: 'done' })),
    ...overrides
  }
}

describe('Facebook Common Challenge runtime', () => {
  it('inspects the live page before bootstrap when the checkpoint is cleared', async () => {
    const calls: string[] = []
    const runtimeDeps = deps({
      inspectChallenge: vi.fn(async () => {
        calls.push('inspect')
        return { type: 'checkpoint_cleared' as const }
      }),
      bootstrapSession: vi.fn(async () => {
        calls.push('bootstrap')
        return validSession()
      }),
      inspectIdentity: vi.fn(async () => {
        calls.push('identity')
        return { state: 'match' as const, expectedUserId: '123456', currentUserId: '123456', message: 'match' }
      })
    })

    const result = await runFacebookCommonChallengeRuntime(input(), runtimeDeps)
    expect(result.state).toBe('resolved')
    expect(result.accountStatus).toBe('valid')
    expect(calls).toEqual(['inspect', 'bootstrap', 'identity'])
  })

  it('does not bootstrap through identity verification or security review', async () => {
    const bootstrap = vi.fn(async () => validSession())
    const identityResult = await runFacebookCommonChallengeRuntime(input(), deps({
      inspectChallenge: vi.fn(async () => ({ type: 'identity_verification_required' as const, checkpointKind: '956' as const })),
      bootstrapSession: bootstrap
    }))
    expect(identityResult.state).toBe('needs_attention')
    expect(identityResult.accountStatus).toBe('identity_verification_required')
    expect(bootstrap).not.toHaveBeenCalled()

    const securityResult = await runFacebookCommonChallengeRuntime(input(), deps({
      inspectChallenge: vi.fn(async () => ({ type: 'security_review_required' as const, checkpointKind: '956' as const })),
      bootstrapSession: bootstrap
    }))
    expect(securityResult.state).toBe('needs_attention')
    expect(securityResult.accountStatus).toBe('security_review_required')
    expect(bootstrap).not.toHaveBeenCalled()
  })

  it('keeps locked and disabled accounts distinct from generic security review', async () => {
    const bootstrap = vi.fn(async () => validSession())
    const locked = await runFacebookCommonChallengeRuntime(input(), deps({
      inspectChallenge: vi.fn(async () => ({ type: 'account_locked' as const, checkpointKind: '956_purple_lock' as const })),
      bootstrapSession: bootstrap
    }))
    expect(locked).toMatchObject({ state: 'needs_attention', accountStatus: 'locked', checkpointKind: '956_purple_lock' })

    const disabled = await runFacebookCommonChallengeRuntime(input(), deps({
      inspectChallenge: vi.fn(async () => ({ type: 'account_disabled' as const, checkpointKind: 'disabled' as const })),
      bootstrapSession: bootstrap
    }))
    expect(disabled).toMatchObject({ state: 'needs_attention', accountStatus: 'disabled', checkpointKind: 'disabled' })
    expect(bootstrap).not.toHaveBeenCalled()
  })

  it('uses the supported Email continuation then verifies the cleared session/account', async () => {
    const inspect = vi.fn()
      .mockResolvedValueOnce({ type: 'email_code_challenge' as const, checkpointKind: '956' as const })
      .mockResolvedValueOnce({ type: 'checkpoint_cleared' as const })
    const result = await runFacebookCommonChallengeRuntime(input({ getEmailCode: vi.fn() }), deps({
      inspectChallenge: inspect,
      completeEmailChallenge: vi.fn(async () => ({ status: 'success' as const, message: 'email accepted' }))
    }))
    expect(result.state).toBe('resolved')
    expect(result.accountStatus).toBe('valid')
    expect(inspect).toHaveBeenCalledTimes(2)
  })

  it('keeps an unresolved Email challenge as email_code_required instead of needs_login', async () => {
    const result = await runFacebookCommonChallengeRuntime(input(), deps({
      inspectChallenge: vi.fn(async () => ({ type: 'email_code_challenge' as const, checkpointKind: '282' as const })),
      completeEmailChallenge: vi.fn(async () => ({ status: 'email_code_not_found' as const, message: 'waiting email' }))
    }))
    expect(result).toMatchObject({ state: 'waiting', accountStatus: 'email_code_required', checkpointKind: '282' })
  })

  it('allows safe login/TOTP continuation but keeps unresolved challenges typed', async () => {
    const inspect = vi.fn()
      .mockResolvedValueOnce({ type: 'totp_2fa_challenge' as const })
      .mockResolvedValueOnce({ type: 'totp_2fa_challenge' as const })
    const unresolvedSession: FacebookSessionResult = {
      accountId: 7,
      status: 'needs_login',
      reason: 'two_factor_failed',
      cookie: null,
      cookieStatus: 'needs_login',
      lastCookieCheck: Date.now(),
      message: '2FA still required'
    }
    const result = await runFacebookCommonChallengeRuntime(input(), deps({
      inspectChallenge: inspect,
      bootstrapSession: vi.fn(async () => unresolvedSession)
    }))
    expect(result.state).toBe('needs_login')
    expect(result.challengeType).toBe('totp_2fa_challenge')
    expect(result.accountStatus).toBe('two_factor_required')
  })
})
