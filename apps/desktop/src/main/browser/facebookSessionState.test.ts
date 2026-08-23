import { describe, expect, it } from 'vitest'
import {
  classifyFacebookSessionGate,
  facebookLocaleCookieValue,
  generateTotp,
  resolveTwoFactorCode
} from './facebookSession'

describe('Facebook session gate', () => {
  it('classifies a persisted logged-in session as valid', () => {
    expect(classifyFacebookSessionGate({
      url: 'https://www.facebook.com/',
      hasUserCookie: true,
      loginFormVisible: false,
      twoFactorVisible: false,
      manualVerificationTextVisible: false
    })).toBe('valid')
  })

  it('classifies an expired session as login required', () => {
    expect(classifyFacebookSessionGate({
      url: 'https://www.facebook.com/login/',
      hasUserCookie: false,
      loginFormVisible: true,
      twoFactorVisible: false,
      manualVerificationTextVisible: false
    })).toBe('login')
  })

  it('classifies checkpoint/identity verification as manual', () => {
    expect(classifyFacebookSessionGate({
      url: 'https://www.facebook.com/checkpoint/123/',
      hasUserCookie: false,
      loginFormVisible: false,
      twoFactorVisible: false,
      manualVerificationTextVisible: true
    })).toBe('manual_verification')
  })

  it('prioritizes an authenticator 2FA input over a checkpoint URL regression', () => {
    expect(classifyFacebookSessionGate({
      url: 'https://www.facebook.com/checkpoint/123/',
      hasUserCookie: false,
      loginFormVisible: false,
      twoFactorVisible: true,
      manualVerificationTextVisible: false
    })).toBe('two_factor')
  })
})

describe('Facebook account 2FA', () => {
  it('uses an already supplied current OTP without transforming it', () => {
    expect(resolveTwoFactorCode(' 123 456 ')).toBe('123456')
  })

  it('generates the RFC 6238 SHA1 vector from a Base32 secret', () => {
    expect(generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000, 8)).toBe('94287082')
  })
})

describe('Facebook locale', () => {
  it('maps supported locale settings to Facebook locale cookie values', () => {
    expect(facebookLocaleCookieValue('auto')).toBeNull()
    expect(facebookLocaleCookieValue('vi-VN')).toBe('vi_VN')
    expect(facebookLocaleCookieValue('en-US')).toBe('en_US')
  })
})