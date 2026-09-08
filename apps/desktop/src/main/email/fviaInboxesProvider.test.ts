import { describe, expect, it } from 'vitest'
import type { MailMessageSnapshot } from './verificationCodeParser'
import {
  FviaInboxesProvider,
  type FviaInboxesMailboxDriver,
  type FviaInboxesMessageSummary
} from './fviaInboxesProvider'

function summary(key: string, receivedAt: number | null = null): FviaInboxesMessageSummary {
  return {
    key,
    sender: '',
    subject: 'Microsoft account security code',
    preview: 'Microsoft account security code',
    receivedLabel: '',
    receivedAt
  }
}

function snapshot(message: FviaInboxesMessageSummary, code: string): MailMessageSnapshot {
  return {
    id: message.key,
    receivedAt: message.receivedAt ?? 0,
    sender: 'account-security-noreply@accountprotection.microsoft.com',
    subject: message.subject,
    bodyPreview: message.preview,
    bodyText: `Use security code ${code} to continue.`
  }
}

describe('FviaInboxesProvider', () => {
  it('uses one provider for all audited Fvia domains and supports PRIMARY role', async () => {
    const mail = summary('mail-1', 1_000_000)
    const driver: FviaInboxesMailboxDriver = {
      ensureMailbox: async (mailbox) => ({ status: 'ready', activeMailbox: mailbox }),
      listMessages: async () => [mail],
      readMessage: async (message) => snapshot(message, '123456'),
      refreshMailbox: async () => undefined
    }
    const provider = new FviaInboxesProvider(driver, { now: () => 1_000_000 })

    const result = await provider.getVerificationCode({
      mailbox: 'Owner@FviaMail.work',
      role: 'primary',
      purpose: 'microsoft_security',
      timeoutMs: 0
    })

    expect(result.providerId).toBe('fvia_inboxes')
    expect(result.mailbox).toBe('owner@fviamail.work')
    expect(result.status).toBe('success')
    expect(result.code).toBe('123456')
  })

  it('baselines timestamp-less existing mail before Send and accepts only a newly observed key after Send', async () => {
    let now = 2_000_000
    let messages = [summary('old-mail')]
    const codes = new Map([
      ['old-mail', '111111'],
      ['new-mail', '222222']
    ])
    const driver: FviaInboxesMailboxDriver = {
      ensureMailbox: async (mailbox) => ({ status: 'ready', activeMailbox: mailbox }),
      listMessages: async () => messages,
      readMessage: async (message) => snapshot(message, codes.get(message.key) ?? '000000'),
      refreshMailbox: async () => undefined
    }
    const provider = new FviaInboxesProvider(driver, { now: () => now })

    const warm = await provider.getVerificationCode({
      mailbox: 'owner@fviainboxes.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 0
    })
    expect(warm.code).toBe('111111')

    const drained = await provider.getVerificationCode({
      mailbox: 'owner@fviainboxes.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 0
    })
    expect(drained.status).toBe('message_not_found')

    const requestedAt = now
    now += 1_000
    messages = [summary('new-mail'), summary('old-mail')]

    const fresh = await provider.getVerificationCode({
      mailbox: 'owner@fviainboxes.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      notBefore: requestedAt,
      timeoutMs: 0
    })
    expect(fresh.status).toBe('success')
    expect(fresh.code).toBe('222222')
  })

  it('rejects another Fvia mailbox identity instead of reading the wrong inbox', async () => {
    const driver: FviaInboxesMailboxDriver = {
      ensureMailbox: async () => ({ status: 'ready', activeMailbox: 'other@dropinboxes.com' }),
      listMessages: async () => [summary('mail-1')],
      readMessage: async () => null,
      refreshMailbox: async () => undefined
    }
    const provider = new FviaInboxesProvider(driver)

    const result = await provider.getVerificationCode({
      mailbox: 'owner@dropinboxes.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 0
    })

    expect(result.status).toBe('mailbox_not_found')
  })

  it('rejects a mailbox from another provider family', async () => {
    const driver: FviaInboxesMailboxDriver = {
      ensureMailbox: async (mailbox) => ({ status: 'ready', activeMailbox: mailbox }),
      listMessages: async () => [],
      readMessage: async () => null,
      refreshMailbox: async () => undefined
    }
    const provider = new FviaInboxesProvider(driver)

    const result = await provider.getVerificationCode({
      mailbox: 'owner@getnada.com',
      role: 'primary',
      purpose: 'generic_verification',
      timeoutMs: 0
    })

    expect(result.status).toBe('unsupported_mailbox')
  })
})
