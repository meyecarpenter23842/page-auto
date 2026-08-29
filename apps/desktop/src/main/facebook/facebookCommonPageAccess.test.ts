import { describe, expect, it } from 'vitest'
import { normalizePageIdentityFailure } from './facebookCommonRuntime'

describe('Facebook Common Page identity result normalization', () => {
  it('preserves a typed Page-access failure instead of collapsing it into a generic identity error', () => {
    expect(normalizePageIdentityFailure({
      status: 'failed',
      code: 'page_access_unavailable',
      message: 'Tài khoản không quản lý hoặc không còn quyền truy cập Page này; không thể switch Page.'
    })).toEqual({
      status: 'failed',
      code: 'page_access_unavailable',
      message: 'Tài khoản không quản lý hoặc không còn quyền truy cập Page này; không thể switch Page.'
    })
  })

  it('keeps unknown Page-switch failures conservative', () => {
    expect(normalizePageIdentityFailure({
      status: 'failed',
      code: 'unknown_page_failure',
      message: 'unknown'
    })).toEqual({
      status: 'failed',
      code: 'page_identity_unconfirmed',
      message: 'unknown'
    })
  })
})
