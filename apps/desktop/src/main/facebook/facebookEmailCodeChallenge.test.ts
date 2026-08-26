import { describe, expect, it } from 'vitest'
import { classifyFacebookEmailChallengeSurface, facebookEmailCodeRequest } from './facebookEmailCodeChallenge'

describe('Facebook Email code challenge boundary', () => {
  it('requires a code input plus an Email-specific signal', () => {
    expect(classifyFacebookEmailChallengeSurface({
      url: 'https://www.facebook.com/checkpoint/',
      promptVisible: true,
      inputVisible: true
    })).toBe(true)
    expect(classifyFacebookEmailChallengeSurface({
      url: 'https://www.facebook.com/checkpoint/',
      promptVisible: false,
      inputVisible: true
    })).toBe(false)
    expect(classifyFacebookEmailChallengeSurface({
      url: 'https://www.facebook.com/confirmemail/',
      promptVisible: false,
      inputVisible: true
    })).toBe(true)
    expect(classifyFacebookEmailChallengeSurface({
      url: 'https://www.facebook.com/identity/',
      promptVisible: true,
      inputVisible: false
    })).toBe(false)
  })

  it('builds an account-only Email Support request with no Facebook profile/network state', () => {
    const request = facebookEmailCodeRequest(42, 1_000_000)
    expect(request).toEqual({
      accountId: 42,
      consumer: 'facebook_login',
      notBefore: 880_000,
      timeoutMs: 15_000
    })
    const serialized = JSON.stringify(request)
    expect(serialized).not.toMatch(/proxy|ipv4|ipv6|profile|cookie|password|refresh|token/i)
  })
})
