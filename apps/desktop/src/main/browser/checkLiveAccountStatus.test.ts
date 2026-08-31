import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import type { AccountStatus } from '../../shared/accounts'
import type { FacebookSessionResult } from './facebookSession'
import { resolveCheckLiveAccountStatus } from './checkLiveAccountStatus'

const page = {} as Page

function session(reason: FacebookSessionResult['reason'], status: FacebookSessionResult['status'] = 'needs_login'): FacebookSessionResult {
  return {
    accountId: 7,
    status,
    reason,
    cookie: null,
    cookieStatus: status === 'valid' ? 'valid' : 'needs_login',
    lastCookieCheck: 123,
    message: reason
  }
}

describe('resolveCheckLiveAccountStatus', () => {
  it('keeps normal session failures distinct instead of collapsing to needs_login', async () => {
    await expect(resolveCheckLiveAccountStatus(page, session('login_required'))).resolves.toBe('needs_login')
    await expect(resolveCheckLiveAccountStatus(page, session('login_failed'))).resolves.toBe('login_failed')
    await expect(resolveCheckLiveAccountStatus(page, session('two_factor_missing'))).resolves.toBe('two_factor_required')
    await expect(resolveCheckLiveAccountStatus(page, session('two_factor_failed'))).resolves.toBe('two_factor_failed')
  })

  it.each<AccountStatus>([
    'disabled',
    'locked',
    'identity_verification_required',
    'security_review_required',
    'checkpoint_282',
    'checkpoint_956',
    'checkpoint_unknown'
  ])('uses live checkpoint classification: %s', async (detected) => {
    await expect(resolveCheckLiveAccountStatus(page, session('checkpoint'), async () => detected)).resolves.toBe(detected)
  })

  it('does not report false valid if a checkpoint disappears during classification', async () => {
    await expect(resolveCheckLiveAccountStatus(page, session('checkpoint'), async () => 'valid')).resolves.toBe('checkpoint_unknown')
  })
})
