import { describe, expect, it } from 'vitest'
import type { AccountStatus } from '../../../shared/accounts'
import { checkLiveSummaryBucket } from './checkLiveSummary'

describe('checkLiveSummaryBucket', () => {
  it('keeps valid and unknown in their own buckets', () => {
    expect(checkLiveSummaryBucket('valid')).toBe('live')
    expect(checkLiveSummaryBucket('unknown')).toBe('unknown')
    expect(checkLiveSummaryBucket(undefined)).toBe('unknown')
  })

  it.each<AccountStatus>([
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
  ])('counts canonical problem status as problem: %s', (status) => {
    expect(checkLiveSummaryBucket(status)).toBe('problem')
  })
})
