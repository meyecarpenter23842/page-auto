import { describe, expect, it } from 'vitest'
import { classifyFacebookAccountIdentity, expectedFacebookUserId } from './facebookAccountIdentity'

describe('Facebook account identity', () => {
  it('extracts only numeric account UIDs for c_user verification', () => {
    expect(expectedFacebookUserId(' 123456 ')).toBe('123456')
    expect(expectedFacebookUserId('page.user.name')).toBeNull()
  })

  it('requires c_user to match the configured numeric UID', () => {
    expect(classifyFacebookAccountIdentity('123456', '123456')).toBe('match')
    expect(classifyFacebookAccountIdentity('123456', '999999')).toBe('mismatch')
    expect(classifyFacebookAccountIdentity('123456', null)).toBe('missing')
  })

  it('does not claim a mismatch when the configured UID is not numeric', () => {
    expect(classifyFacebookAccountIdentity('username.login', '123456')).toBe('unverifiable')
  })
})
