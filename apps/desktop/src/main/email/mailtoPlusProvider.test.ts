import { describe, expect, it } from 'vitest'
import type { MailMessageSnapshot } from './verificationCodeParser'
import {
  effectiveMailtoPlusCodeTimeoutMs,
  MailtoPlusProvider,
  type MailtoPlusMailboxDriver
} from './mailtoPlusProvider'
import type { BrowserMailboxMessageSummary } from './browserMailboxProvider'

function summary(key: string): BrowserMailboxMessageSummary {
  return {
    key,
    sender: 'account-security-noreply@accountprotection.microsoft.com',
    subject: 'Microsoft account security code',
    preview: 'Microsoft account security code',
    receivedLabel: '',
    receivedAt: null
  }
}

function snapshot(message: BrowserMailboxMessageSummary, code: string): MailMessageSnapshot {
  return {
    id: message.key,
    receivedAt: 0,
    sender: message.sender,
    subject: message.subject,
    bodyPreview: message.preview,
    bodyText: `Use security code ${code} to continue.`
  }
}

describe('MailtoPlusProvider', () => {
  it('owns resume freshness and preserves the legacy 25-second Microsoft recovery wait', () => {
    const provider = new MailtoPlusProvider({
      ensureMailbox: async (mailbox) => ({ status: 'ready', activeMailbox: mailbox }),
      listMessages: async () => [],
      readMessage: async () => null,
      refreshMailbox: async () => undefined
    })

    expect(provider.resumeFreshness).toBe('baseline_current')
    expect(effectiveMailtoPlusCodeTimeoutMs({
      mailbox: 'owner@mailto.plus',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 10_000
    })).toBe(25_000)
    expect(effectiveMailtoPlusCodeTimeoutMs({
      mailbox: 'owner@mailto.plus',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 0
    })).toBe(0)
  })

  it('supports the audited mailto.plus domain for PRIMARY role', async () => {
    const mail = summary('mailto-plus:1')
    const driver: MailtoPlusMailboxDriver = {
      ensureMailbox: async (mailbox) => ({ status: 'ready', activeMailbox: mailbox }),
      listMessages: async () => [mail],
      readMessage: async (message) => snapshot(message, '123456'),
      refreshMailbox: async () => undefined
    }
    const provider = new MailtoPlusProvider(driver, { now: () => 1_000_000 })

    const result = await provider.getVerificationCode({
      mailbox: 'Owner@MAILTO.PLUS',
      role: 'primary',
      purpose: 'microsoft_security',
      timeoutMs: 0
    })

    expect(result.providerId).toBe('mailto_plus')
    expect(result.mailbox).toBe('owner@mailto.plus')
    expect(result.status).toBe('success')
    expect(result.code).toBe('123456')
  })

  it('does not reuse an already consumed code in a repeated Microsoft recovery challenge', async () => {
    let now = 2_000_000
    let messages = [summary('mailto-plus:1')]
    const codes = new Map([
      ['mailto-plus:1', '111111'],
      ['mailto-plus:2', '222222']
    ])
    const driver: MailtoPlusMailboxDriver = {
      ensureMailbox: async (mailbox) => ({ status: 'ready', activeMailbox: mailbox }),
      listMessages: async () => messages,
      readMessage: async (message) => snapshot(message, codes.get(message.key) ?? '000000'),
      refreshMailbox: async () => undefined
    }
    const provider = new MailtoPlusProvider(driver, { now: () => now })

    const warm = await provider.getVerificationCode({
      mailbox: 'owner@mailto.plus',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 0
    })
    expect(warm.code).toBe('111111')

    const drained = await provider.getVerificationCode({
      mailbox: 'owner@mailto.plus',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 0
    })
    expect(drained.status).toBe('message_not_found')

    const requestedAt = now
    now += 1_000
    messages = [summary('mailto-plus:2'), summary('mailto-plus:1')]

    const fresh = await provider.getVerificationCode({
      mailbox: 'owner@mailto.plus',
      role: 'recovery',
      purpose: 'microsoft_security',
      notBefore: requestedAt,
      timeoutMs: 0
    })
    expect(fresh.status).toBe('success')
    expect(fresh.code).toBe('222222')
  })

  it('rejects a mailbox from another provider family', async () => {
    const driver: MailtoPlusMailboxDriver = {
      ensureMailbox: async (mailbox) => ({ status: 'ready', activeMailbox: mailbox }),
      listMessages: async () => [],
      readMessage: async () => null,
      refreshMailbox: async () => undefined
    }
    const provider = new MailtoPlusProvider(driver)

    const result = await provider.getVerificationCode({
      mailbox: 'owner@getnada.com',
      role: 'primary',
      purpose: 'generic_verification',
      timeoutMs: 0
    })

    expect(result.status).toBe('unsupported_mailbox')
  })
})
