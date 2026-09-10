import { describe, expect, it, vi } from 'vitest'
import type { MailMessageSnapshot } from './verificationCodeParser'
import {
  classifyMicrosoftMailboxMessage,
  type BrowserMailboxMessageSummary
} from './browserMailboxProvider'
import { InboxesProvider, type InboxesMailboxDriver } from './inboxesProvider'

function summary(
  key: string,
  subject: string,
  preview: string,
  receivedAt: number
): BrowserMailboxMessageSummary {
  return {
    key,
    sender: 'Microsoft account team <account-security-noreply@accountprotection.microsoft.com>',
    subject,
    preview,
    receivedLabel: 'recent',
    receivedAt
  }
}

function snapshot(message: BrowserMailboxMessageSummary, code: string): MailMessageSnapshot {
  return {
    id: message.key,
    receivedAt: message.receivedAt ?? 0,
    sender: message.sender,
    subject: message.subject,
    bodyPreview: message.preview,
    bodyText: `Microsoft account security code ${code}`
  }
}

describe('Inboxes Microsoft message classification', () => {
  it('rejects unusual-sign-in and other Microsoft notifications before message detail', () => {
    const now = 1_000_000
    expect(classifyMicrosoftMailboxMessage(summary(
      'code',
      'Personal Microsoft account security code',
      'Security code for your Microsoft account',
      now
    ))).toBe('microsoft_security_code')
    expect(classifyMicrosoftMailboxMessage(summary(
      'unusual',
      'Microsoft account unusual sign-in activity',
      'We detected unusual sign-in activity on your Microsoft account.',
      now
    ))).toBe('microsoft_unusual_signin_notification')
    expect(classifyMicrosoftMailboxMessage(summary(
      'notice',
      'Microsoft account notice',
      'Review recent activity in your account.',
      now
    ))).toBe('microsoft_other_notification')
  })

  it('recognizes the live Microsoft single-use-code subject before detail open', () => {
    expect(classifyMicrosoftMailboxMessage(summary(
      'single-use',
      'Your single-use code',
      'Your single-use code',
      1_500_000
    ))).toBe('microsoft_security_code')
  })

  it('selects security-code B even when a newer unusual-sign-in notification is present', async () => {
    const now = 2_000_000
    const codeA = summary('code-a', 'Personal Microsoft account security code', 'Security code 111111', now - 25_000)
    const codeB = summary('code-b', 'Personal Microsoft account security code', 'Security code 222222', now - 10_000)
    const unusual = summary('notice-newest', 'Microsoft account unusual sign-in activity', 'Unusual sign-in activity detected.', now - 5_000)
    const opened: string[] = []

    const driver: InboxesMailboxDriver = {
      async ensureMailbox(mailbox) {
        return { status: 'ready', activeMailbox: mailbox }
      },
      async listMessages() {
        return [codeA, unusual, codeB]
      },
      async readMessage(message) {
        opened.push(message.key)
        return snapshot(message, message.key === 'code-b' ? '222222' : '111111')
      },
      async refreshMailbox() {}
    }

    const provider = new InboxesProvider(driver, { now: () => now })
    const result = await provider.getVerificationCode({
      mailbox: 'owner@getnada.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      notBefore: now - 30_000,
      timeoutMs: 0
    })

    expect(result.status).toBe('success')
    expect(result.messageKey).toBe('code-b')
    expect(result.code).toBe('222222')
    expect(opened).toEqual(['code-b'])
  })

  it('rejects baseline/consumed message keys before opening detail even inside freshness grace', async () => {
    const now = 3_000_000
    const oldRound = summary('round-a', 'Microsoft account security code', 'Security code 111111', now - 2_000)
    const currentRound = summary('round-b', 'Microsoft account security code', 'Security code 222222', now - 1_000)
    const opened: string[] = []

    const driver: InboxesMailboxDriver = {
      async ensureMailbox(mailbox) {
        return { status: 'ready', activeMailbox: mailbox }
      },
      async listMessages() {
        return [oldRound, currentRound]
      },
      async readMessage(message) {
        opened.push(message.key)
        return snapshot(message, message.key === 'round-b' ? '222222' : '111111')
      },
      async refreshMailbox() {}
    }

    const provider = new InboxesProvider(driver, { now: () => now })
    const result = await provider.getVerificationCode({
      mailbox: 'owner@getnada.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      notBefore: now - 5_000,
      excludedMessageKeys: ['round-a'],
      timeoutMs: 0
    })

    expect(result.status).toBe('success')
    expect(result.messageKey).toBe('round-b')
    expect(opened).toEqual(['round-b'])
  })

  it('snapshots all current message keys without opening any message detail', async () => {
    const now = 4_000_000
    const messages = [
      summary('code-a', 'Microsoft account security code', 'Security code 111111', now - 10_000),
      summary('notice-a', 'Microsoft account unusual sign-in activity', 'Unusual sign-in activity.', now - 5_000)
    ]
    const readMessage = vi.fn(async () => null)
    const driver: InboxesMailboxDriver = {
      async ensureMailbox(mailbox) {
        return { status: 'ready', activeMailbox: mailbox }
      },
      async listMessages() {
        return messages
      },
      readMessage,
      async refreshMailbox() {}
    }

    const provider = new InboxesProvider(driver, { now: () => now })
    const result = await provider.snapshotMessageKeys({
      mailbox: 'owner@getnada.com',
      role: 'recovery',
      purpose: 'microsoft_security'
    })

    expect(result.status).toBe('success')
    expect(result.messageKeys).toEqual(['code-a', 'notice-a'])
    expect(readMessage).not.toHaveBeenCalled()
  })
})
