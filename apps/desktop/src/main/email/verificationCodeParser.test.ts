import { describe, expect, it } from 'vitest'
import { parseVerificationCode } from './verificationCodeParser'

describe('parseVerificationCode', () => {
  it('prefers contextual recent verification codes', () => {
    const now = Date.now()
    const result = parseVerificationCode([
      { id: 'old', sender: 'news@example.com', subject: 'Receipt 123456', receivedAt: now - 3_600_000, body: 'Order 123456' },
      { id: 'new', sender: 'account-security@microsoft.com', subject: 'Your verification code', receivedAt: now - 60_000, body: 'Use code 654321 to verify your sign-in.' }
    ], now)
    expect(result?.code).toBe('654321')
    expect(result?.messageId).toBe('new')
  })

  it('ignores stale messages outside the configured window', () => {
    const now = Date.now()
    const result = parseVerificationCode([
      { id: 'stale', sender: 'security@example.com', subject: 'Verification code', receivedAt: now - 30 * 60 * 60 * 1000, body: 'Code: 222222' }
    ], now)
    expect(result).toBeNull()
  })
})
