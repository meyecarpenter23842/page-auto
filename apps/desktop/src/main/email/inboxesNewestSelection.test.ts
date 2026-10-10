import { describe, expect, it } from 'vitest'
import type { MailMessageSnapshot } from './verificationCodeParser'
import { InboxesProvider, type InboxesMailboxDriver, type InboxesMessageSummary } from './inboxesProvider'

describe('Inboxes newest-message selection', () => {
  it('reads the newest fresh verification message first even when DOM order is older-first', async () => {
    const now = 1_000_000
    const older: InboxesMessageSummary = {
      key: 'older',
      sender: 'Microsoft account team',
      subject: 'Microsoft account security code',
      preview: 'Security code 111111',
      receivedLabel: '5 secs ago',
      receivedAt: now - 5_000
    }
    const newer: InboxesMessageSummary = {
      key: 'newer',
      sender: 'Microsoft account team',
      subject: 'Microsoft account security code',
      preview: 'Security code 222222',
      receivedLabel: '1 sec ago',
      receivedAt: now - 1_000
    }

    const opened: string[] = []
    const driver: InboxesMailboxDriver = {
      async ensureMailbox(mailbox) {
        return { status: 'ready', activeMailbox: mailbox }
      },
      async listMessages() {
        return [older, newer]
      },
      async readMessage(message) {
        opened.push(message.key)
        const code = message.key === 'newer' ? '222222' : '111111'
        return {
          id: message.key,
          receivedAt: message.receivedAt ?? 0,
          sender: message.sender,
          subject: message.subject,
          bodyPreview: message.preview,
          bodyText: `Microsoft account security code ${code}`
        } satisfies MailMessageSnapshot
      },
      async refreshMailbox() {}
    }

    const provider = new InboxesProvider(driver, { now: () => now })
    const result = await provider.getVerificationCode({
      mailbox: 'owner@fivermail.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      notBefore: now - 10_000,
      timeoutMs: 0
    })

    expect(result.status).toBe('success')
    expect(result.code).toBe('222222')
    expect(opened).toEqual(['newer'])
  })
})
