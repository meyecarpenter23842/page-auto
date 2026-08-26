import { describe, expect, it } from 'vitest'
import { validateEmailPassword } from './emailPasswordActionPolicy'

describe('email password action policy', () => {
  it('requires Microsoft-compatible minimum length without mutating the secret', () => {
    expect(() => validateEmailPassword('short')).toThrow('ít nhất 8 ký tự')
    expect(validateEmailPassword('  Abcd1234  ')).toBe('  Abcd1234  ')
  })

  it('rejects control characters and excessive input', () => {
    expect(() => validateEmailPassword('Abcd1234\n')).toThrow('ký tự điều khiển')
    expect(() => validateEmailPassword('x'.repeat(257))).toThrow('256 ký tự')
  })
})
