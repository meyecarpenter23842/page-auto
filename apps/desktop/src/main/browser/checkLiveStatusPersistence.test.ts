import { describe, expect, it } from 'vitest'
import type { AccountStatus } from '../../shared/accounts'
import { persistedCheckLiveAccountStatus } from './checkLiveStatusPersistence'

describe('persistedCheckLiveAccountStatus', () => {
  it.each<AccountStatus>([
    'valid',
    'needs_login',
    'login_failed',
    'two_factor_required',
    'two_factor_failed',
    'email_code_required',
    'checkpoint_282',
    'checkpoint_956',
    'identity_verification_required',
    'security_review_required',
    'locked',
    'disabled',
    'checkpoint_unknown',
    'needs_attention'
  ])('persists canonical Facebook evidence: %s', (status) => {
    expect(persistedCheckLiveAccountStatus('valid', { status, cookieStatus: 'needs_login' })).toBe(status)
  })

  it('preserves the previous Facebook status on a technical worker/browser error', () => {
    expect(persistedCheckLiveAccountStatus('disabled', { status: 'unknown', cookieStatus: 'error' })).toBe('disabled')
  })

  it('allows a real unchecked/unknown session result when it is not a technical error', () => {
    expect(persistedCheckLiveAccountStatus('needs_login', { status: 'unknown', cookieStatus: 'needs_login' })).toBe('unknown')
  })
})
