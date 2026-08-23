import { describe, expect, it } from 'vitest'
import { generateTotp, parseFacebookCookies } from './facebookSession'

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
})

describe('generateTotp', () => {
  it('matches the RFC 6238 SHA-1 test secret reduced to six digits', () => {
    expect(generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000, 6)).toBe('287082')
  })

  it('accepts otpauth URLs', () => {
    expect(generateTotp('otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000, 6)).toBe('287082')
  })
})
