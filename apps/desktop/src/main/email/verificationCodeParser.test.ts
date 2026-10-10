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

  it('ignores numeric runs inside mailbox identifiers and prefers the labelled Microsoft security code', () => {
    const now = Date.UTC(2026, 8, 8, 8, 50, 0)
    const match = parseVerificationCode([
      {
        id: 'live-microsoft',
        receivedAt: now - 2 * 60_000,
        sender: 'account-security-noreply@accountprotection.microsoft.com',
        subject: 'Personal Microsoft account security code',
        bodyPreview: 'Microsoft account Security code',
        bodyText: [
          'Please use the following security code for your personal Microsoft account is**3@hotmail.com.',
          'Recovery mailbox islaopalischr37063b2401@fivermail.com',
          'Security code: 142679'
        ].join('\n')
      }
    ], now)

    expect(match?.code).toBe('142679')
    expect(match?.code).not.toBe('37063')
    expect(match?.code).not.toBe('2401')
  })

  it('never selects a rendered year like 2026 ahead of a six-digit Microsoft code', () => {
    const now = Date.UTC(2026, 8, 9, 2, 0, 0)
    const match = parseVerificationCode([
      {
        id: 'live-inboxes-detail',
        receivedAt: now - 1_000,
        sender: 'account-security-noreply@accountprotection.microsoft.com',
        subject: 'Personal Microsoft account security code',
        bodyPreview: 'Microsoft account Security code',
        bodyText: 'Microsoft account\n2026 Microsoft Corporation\nUse 481726 to continue.'
      }
    ], now)

    expect(match?.code).toBe('481726')
    expect(match?.code).not.toBe('2026')
  })

  it('does not accept a standalone year as the only numeric candidate in a security mail', () => {
    const now = Date.UTC(2026, 8, 9, 2, 0, 0)
    expect(parseVerificationCode([
      {
        id: 'year-only',
        receivedAt: now - 1_000,
        sender: 'account-security-noreply@accountprotection.microsoft.com',
        subject: 'Microsoft security notice',
        bodyPreview: 'Verification information',
        bodyText: 'Copyright 2026 Microsoft Corporation.'
      }
    ], now)).toBeNull()
  })

  it('keeps an explicitly labelled four-digit code valid even when it looks like a year', () => {
    const now = Date.UTC(2026, 8, 9, 2, 0, 0)
    const match = parseVerificationCode([
      {
        id: 'labelled-short-code',
        receivedAt: now - 1_000,
        sender: 'security@example.com',
        subject: 'Verification code',
        bodyPreview: '',
        bodyText: 'Security code: 2026'
      }
    ], now)
    expect(match?.code).toBe('2026')
  })

  it('does not treat a recent order/reference number as a verification code', () => {
    const now = Date.UTC(2026, 7, 24, 8, 0, 0)
    expect(parseVerificationCode([
      { id: 'order', receivedAt: now - 2_000, sender: 'store@example.com', subject: 'Order 123456 shipped', bodyPreview: 'Tracking 887766', bodyText: '' }
    ], now)).toBeNull()
  })

  it('returns null when there is no plausible code', () => {
    const now = Date.UTC(2026, 7, 24, 8, 0, 0)
    expect(parseVerificationCode([
      { id: 'x', receivedAt: now - 1_000, sender: 'news@example.com', subject: 'Hello', bodyPreview: 'Welcome!', bodyText: 'Thanks for subscribing.' }
    ], now)).toBeNull()
  })
})
