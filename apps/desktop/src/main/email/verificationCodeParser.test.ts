import { describe, expect, it } from 'vitest'
import { parseVerificationCode } from './verificationCodeParser'

describe('parseVerificationCode', () => {
  it('prefers a recent verification-code mail', () => {
    const now = Date.UTC(2026, 7, 24, 8, 0, 0)
    const match = parseVerificationCode([
      { id: 'old', receivedAt: now - 2 * 60 * 60_000, sender: 'store@example.com', subject: 'Order 123456', bodyPreview: '', bodyText: '' },
      { id: 'new', receivedAt: now - 2 * 60_000, sender: 'account-security@example.com', subject: 'Your verification code', bodyPreview: 'Use 654321 to verify your account.', bodyText: '' }
    ], now)
    expect(match?.code).toBe('654321')
    expect(match?.messageId).toBe('new')
  })

  it('returns null when there is no plausible code', () => {
    const now = Date.UTC(2026, 7, 24, 8, 0, 0)
    expect(parseVerificationCode([
      { id: 'x', receivedAt: now - 1_000, sender: 'news@example.com', subject: 'Hello', bodyPreview: 'No code here.', bodyText: 'Welcome!' }
    ], now)).toBeNull()
  })
})
