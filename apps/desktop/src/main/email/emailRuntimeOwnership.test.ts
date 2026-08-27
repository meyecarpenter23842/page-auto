import { describe, expect, it } from 'vitest'
import { EmailRuntimeOwnership } from './emailRuntimeOwnership'

describe('EmailRuntimeOwnership', () => {
  it('allows only one active Email workflow per account', () => {
    const ownership = new EmailRuntimeOwnership()

    expect(ownership.claim(1, 'password')).toBe(true)
    expect(ownership.current(1)).toBe('password')
    expect(ownership.claim(1, 'recovery')).toBe(false)
    expect(ownership.claim(1, 'combo')).toBe(false)
  })

  it('allows only the same owner to continue a retained attention flow', () => {
    const ownership = new EmailRuntimeOwnership()

    expect(ownership.claim(1, 'recovery')).toBe(true)
    expect(ownership.claim(1, 'recovery', true)).toBe(true)
    expect(ownership.claim(1, 'password', true)).toBe(false)
    expect(ownership.claim(2, 'password')).toBe(true)
  })

  it('releases ownership only for the current owner', () => {
    const ownership = new EmailRuntimeOwnership()

    expect(ownership.claim(1, 'combo')).toBe(true)
    ownership.release(1, 'password')
    expect(ownership.current(1)).toBe('combo')

    ownership.release(1, 'combo')
    expect(ownership.current(1)).toBeNull()
    expect(ownership.claim(1, 'password')).toBe(true)
  })
})
