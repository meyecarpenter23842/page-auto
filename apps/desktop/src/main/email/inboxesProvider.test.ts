import { describe, expect, it, vi } from 'vitest'
import type { MailMessageSnapshot } from './verificationCodeParser'
import {
  InboxesProvider,
  type InboxesMailboxDriver,
  type InboxesMessageSummary
} from './inboxesProvider'

function summary(
  key: string,
  subject = 'Microsoft account security code',
  receivedAt = 1_000_000
): InboxesMessageSummary {
  return {
    key,
    sender: 'account-security-noreply@accountprotection.microsoft.com',
    subject,
    preview: 'Security code',
    receivedLabel: 'A few seconds ago',
    receivedAt
  }
}

function snapshot(message: InboxesMessageSummary, code: string): MailMessageSnapshot {
  return {
    id: message.key,
    receivedAt: message.receivedAt ?? 0,
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

  it('warms a timestamped recovery mailbox without opening historical Microsoft mail', async () => {
    const oldMail = summary('old-mail', undefined, 900_000)
    const ensureMailbox = vi.fn(async (mailbox: string) => ({ status: 'ready' as const, activeMailbox: mailbox }))
    const listMessages = vi.fn(async () => [oldMail])
    const readMessage = vi.fn(async (message: InboxesMessageSummary) => snapshot(message, '111111'))
    const driver: InboxesMailboxDriver = {
      ensureMailbox,
      listMessages,
      readMessage,
      refreshMailbox: vi.fn(async () => undefined)
    }
    const provider = new InboxesProvider(driver, { now: () => 1_000_000 })

    const result = await provider.getVerificationCode({
      mailbox: 'owner@fivermail.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 0
    })

    expect(result.status).toBe('message_not_found')
    expect(ensureMailbox).toHaveBeenCalledTimes(1)
    expect(listMessages).toHaveBeenCalledTimes(1)
    expect(readMessage).not.toHaveBeenCalled()
  })

  it('does not reuse the previous message when the caller is challenged two or three times', async () => {
    let now = 1_000_000
    let messages = [summary('mail-1', undefined, now)]
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
    const provider = new InboxesProvider(driver, { now: () => now })
    const baseRequest = { mailbox: 'owner@getnada.com', role: 'recovery' as const, purpose: 'microsoft_security' as const, timeoutMs: 0 }

    expect((await provider.getVerificationCode({ ...baseRequest, notBefore: now - 1_000 })).code).toBe('111111')
    expect((await provider.getVerificationCode({ ...baseRequest, notBefore: now })).status).toBe('message_not_found')

    now += 2_000
    messages = [summary('mail-2', undefined, now), summary('mail-1', undefined, now - 2_000)]
    expect((await provider.getVerificationCode({ ...baseRequest, notBefore: now - 500 })).code).toBe('222222')

    now += 2_000
    messages = [summary('mail-3', undefined, now), summary('mail-2', undefined, now - 2_000), summary('mail-1', undefined, now - 4_000)]
    expect((await provider.getVerificationCode({ ...baseRequest, notBefore: now - 500 })).code).toBe('333333')
  })

  it('rejects historical verification messages even after provider restart', async () => {
    let now = 5_000_000
    let reads = 0
    const oldMail = summary('old', undefined, now - 120_000)
    const newMail = summary('new', undefined, now + 1_000)
    const driver: InboxesMailboxDriver = {
      ensureMailbox: async (mailbox) => ({ status: 'ready', activeMailbox: mailbox }),
      listMessages: async () => {
        reads += 1
        return reads === 1 ? [oldMail] : [newMail, oldMail]
      },
      readMessage: async (message) => snapshot(message, message.key === 'new' ? '654321' : '111111'),
      refreshMailbox: async () => undefined
    }
    const provider = new InboxesProvider(driver, {
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds }
    })

    const result = await provider.getVerificationCode({
      mailbox: 'owner@fivermail.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      notBefore: 5_000_000,
      timeoutMs: 2_000,
      pollIntervalMs: 1_000
    })

    expect(result.status).toBe('success')
    expect(result.code).toBe('654321')
    expect(result.messageKey).toBe('new')
    expect(reads).toBe(2)
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
    const mail = summary('mail-new', undefined, now + 1_000)
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
      notBefore: now,
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
      notBefore: now,
      timeoutMs: 1_000,
      pollIntervalMs: 500
    })
    expect(timeout.status).toBe('timeout')
  })
})
