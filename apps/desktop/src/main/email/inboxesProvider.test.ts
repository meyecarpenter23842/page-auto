import { describe, expect, it, vi } from 'vitest'
import type { MailMessageSnapshot } from './verificationCodeParser'
import {
  InboxesProvider,
  type InboxesMailboxDriver,
  type InboxesMessageSummary
} from './inboxesProvider'

function summary(key: string, subject = 'Microsoft account security code'): InboxesMessageSummary {
  return {
    key,
    sender: 'account-security-noreply@accountprotection.microsoft.com',
    subject,
    preview: 'Security code',
    receivedLabel: 'A few seconds ago'
  }
}

function snapshot(message: InboxesMessageSummary, code: string): MailMessageSnapshot {
  return {
    id: message.key,
    receivedAt: 1_000_000,
    sender: message.sender,
    subject: message.subject,
    bodyPreview: message.preview,
    bodyText: `Use security code ${code} to continue.`
  }
}

describe('InboxesProvider', () => {
  it('uses one provider for fivermail/getnada and returns a typed code result', async () => {
    const mail = summary('mail-1')
    const driver: InboxesMailboxDriver = {
      ensureMailbox: vi.fn(async (mailbox: string) => ({ status: 'ready' as const, activeMailbox: mailbox })),
      listMessages: vi.fn(async () => [mail]),
      readMessage: vi.fn(async (message: InboxesMessageSummary) => snapshot(message, '123456')),
      refreshMailbox: vi.fn(async () => undefined)
    }
    const provider = new InboxesProvider(driver, { now: () => 1_000_000 })

    const result = await provider.getVerificationCode({
      mailbox: 'Owner@FiverMail.com',
      role: 'primary',
      purpose: 'microsoft_security',
      timeoutMs: 0
    })

    expect(result.providerId).toBe('inboxes')
    expect(result.mailbox).toBe('owner@fivermail.com')
    expect(result.status).toBe('success')
    expect(result.code).toBe('123456')
  })

  it('does not reuse the previous message when the caller is challenged two or three times', async () => {
    let messages = [summary('mail-1')]
    const codes = new Map([
      ['mail-1', '111111'],
      ['mail-2', '222222'],
      ['mail-3', '333333']
    ])
    const driver: InboxesMailboxDriver = {
      ensureMailbox: async (mailbox) => ({ status: 'ready', activeMailbox: mailbox }),
      listMessages: async () => messages,
      readMessage: async (message) => snapshot(message, codes.get(message.key) ?? '000000'),
      refreshMailbox: async () => undefined
    }
    const provider = new InboxesProvider(driver, { now: () => 1_000_000 })
    const request = { mailbox: 'owner@getnada.com', role: 'recovery' as const, purpose: 'microsoft_security' as const, timeoutMs: 0 }

    expect((await provider.getVerificationCode(request)).code).toBe('111111')
    expect((await provider.getVerificationCode(request)).status).toBe('message_not_found')

    messages = [summary('mail-2'), summary('mail-1')]
    expect((await provider.getVerificationCode(request)).code).toBe('222222')

    messages = [summary('mail-3'), summary('mail-2'), summary('mail-1')]
    expect((await provider.getVerificationCode(request)).code).toBe('333333')
  })

  it('rejects a mismatched active mailbox instead of reading another inbox', async () => {
    const readMessage = vi.fn()
    const driver: InboxesMailboxDriver = {
      ensureMailbox: async () => ({ status: 'ready', activeMailbox: 'other@getnada.com' }),
      listMessages: async () => [summary('mail-1')],
      readMessage,
      refreshMailbox: async () => undefined
    }
    const provider = new InboxesProvider(driver)

    const result = await provider.getVerificationCode({
      mailbox: 'owner@getnada.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 0
    })

    expect(result.status).toBe('mailbox_not_found')
    expect(readMessage).not.toHaveBeenCalled()
  })

  it('polls by state until a new message arrives and returns timeout when none arrives', async () => {
    let now = 2_000_000
    let reads = 0
    const mail = summary('mail-new')
    const driver: InboxesMailboxDriver = {
      ensureMailbox: async (mailbox) => ({ status: 'ready', activeMailbox: mailbox }),
      listMessages: async () => {
        reads += 1
        return reads >= 2 ? [mail] : []
      },
      readMessage: async (message) => snapshot(message, '778899'),
      refreshMailbox: vi.fn(async () => undefined)
    }
    const provider = new InboxesProvider(driver, {
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds }
    })

    const result = await provider.getVerificationCode({
      mailbox: 'owner@fivermail.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 3_000,
      pollIntervalMs: 1_000
    })
    expect(result.status).toBe('success')
    expect(result.code).toBe('778899')
    expect(reads).toBe(2)

    const emptyProvider = new InboxesProvider({
      ensureMailbox: async (mailbox) => ({ status: 'ready', activeMailbox: mailbox }),
      listMessages: async () => [],
      readMessage: async () => null,
      refreshMailbox: async () => undefined
    }, {
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds }
    })
    const timeout = await emptyProvider.getVerificationCode({
      mailbox: 'owner@fivermail.com',
      role: 'primary',
      purpose: 'microsoft_security',
      timeoutMs: 1_000,
      pollIntervalMs: 500
    })
    expect(timeout.status).toBe('timeout')
  })
})
