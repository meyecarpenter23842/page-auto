import { describe, expect, it, vi } from 'vitest'
import type { MailMessageSnapshot } from './verificationCodeParser'
import {
  InboxesProvider,
  isTransientInboxesRefreshFailure,
  type InboxesMailboxDriver,
  type InboxesMessageSummary
} from './inboxesProvider'

function summary(key: string, receivedAt: number): InboxesMessageSummary {
  return {
    key,
    sender: 'account-security-noreply@accountprotection.microsoft.com',
    subject: 'Microsoft account security code',
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

describe('InboxesProvider transient refresh recovery', () => {
  it('classifies only the canonical refresh failure as retryable', () => {
    expect(isTransientInboxesRefreshFailure({
      providerId: 'inboxes',
      mailbox: 'owner@getnada.com',
      status: 'provider_unavailable',
      code: null,
      sender: null,
      messageKey: null,
      message: 'Không refresh được mailbox Inboxes.com.'
    })).toBe(true)

    expect(isTransientInboxesRefreshFailure({
      providerId: 'inboxes',
      mailbox: 'owner@getnada.com',
      status: 'provider_unavailable',
      code: null,
      sender: null,
      messageKey: null,
      message: 'Không mở được Inboxes.com bằng Email runtime hiện tại.'
    })).toBe(false)
  })

  it('keeps the same provider alive after a refresh error and returns the fresh second-round code', async () => {
    let now = 1_000_000
    let scans = 0
    const oldMail = summary('old-round-key', now - 1_000)
    const secondRoundMail = summary('second-round-key', now + 500)
    const ensureMailbox = vi.fn(async (mailbox: string) => ({ status: 'ready' as const, activeMailbox: mailbox }))
    const refreshMailbox = vi.fn(async () => {
      throw new Error('transient refresh navigation failure')
    })

    const driver: InboxesMailboxDriver = {
      ensureMailbox,
      listMessages: async () => {
        scans += 1
        return scans === 1
          ? [oldMail]
          : [secondRoundMail, oldMail]
      },
      readMessage: async (message) => snapshot(message, message.key === 'second-round-key' ? '222222' : '111111'),
      refreshMailbox
    }

    const provider = new InboxesProvider(driver, {
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds }
    })

    const result = await provider.getVerificationCode({
      mailbox: 'owner@getnada.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      notBefore: 1_000_000,
      excludedMessageKeys: ['old-round-key'],
      timeoutMs: 5_000,
      pollIntervalMs: 500
    })

    expect(result.status).toBe('success')
    expect(result.code).toBe('222222')
    expect(result.messageKey).toBe('second-round-key')
    expect(scans).toBe(2)
    expect(refreshMailbox).toHaveBeenCalledTimes(1)
    expect(ensureMailbox).toHaveBeenCalledTimes(2)
  })

  it('caps refresh re-entry at the provider 60-second hard maximum', async () => {
    const startedAt = 3_000_000
    let now = startedAt
    const ensureMailbox = vi.fn(async (mailbox: string) => ({ status: 'ready' as const, activeMailbox: mailbox }))
    const refreshMailbox = vi.fn(async () => {
      now += 59_500
      throw new Error('transient refresh navigation failure')
    })

    const provider = new InboxesProvider({
      ensureMailbox,
      listMessages: async () => [],
      readMessage: async () => null,
      refreshMailbox
    }, {
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds }
    })

    const result = await provider.getVerificationCode({
      mailbox: 'owner@getnada.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      notBefore: startedAt,
      timeoutMs: 300_000,
      pollIntervalMs: 500
    })

    expect(result.status).toBe('message_not_found')
    expect(now - startedAt).toBe(60_000)
    expect(refreshMailbox).toHaveBeenCalledTimes(1)
    expect(ensureMailbox).toHaveBeenCalledTimes(2)
  })

  it('still fails fast for a non-refresh provider outage', async () => {
    let now = 2_000_000
    const ensureMailbox = vi.fn(async () => ({
      status: 'provider_unavailable' as const,
      message: 'Inboxes upstream unavailable.'
    }))
    const sleep = vi.fn(async (milliseconds: number) => { now += milliseconds })

    const provider = new InboxesProvider({
      ensureMailbox,
      listMessages: async () => [],
      readMessage: async () => null,
      refreshMailbox: async () => undefined
    }, {
      now: () => now,
      sleep
    })

    const result = await provider.getVerificationCode({
      mailbox: 'owner@getnada.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      notBefore: now,
      timeoutMs: 5_000,
      pollIntervalMs: 500
    })

    expect(result.status).toBe('provider_unavailable')
    expect(ensureMailbox).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })
})
