import { describe, expect, it, vi } from 'vitest'
import type { MailMessageSnapshot } from './verificationCodeParser'
import { inboxesMessageRowPreview } from './inboxesPlaywrightDriver'
import {
  createInboxesStableMessageKey,
  InboxesProvider,
  type InboxesMailboxDriver,
  type InboxesMessageSummary
} from './inboxesProvider'

function fallbackMessage(code: string, receivedLabel: string, receivedAt: number): InboxesMessageSummary {
  const sender = 'Microsoft account team'
  const subject = 'Microsoft account security code'
  const rowText = `${sender} ${subject} ${code} ${receivedLabel}`
  return {
    // This reproduces the old driver collision: consecutive Microsoft messages
    // with the same sender/subject/relative label received the same legacy key.
    key: 'row:microsoft account team|microsoft account security code|a few seconds ago',
    sender,
    subject,
    // Use the production row-preview helper so this regression fails if the
    // driver ever drops rendered row content back to subject-only again.
    preview: inboxesMessageRowPreview(rowText, [sender, `${subject} ${code}`, receivedLabel], subject),
    receivedLabel,
    receivedAt
  }
}

function snapshot(message: InboxesMessageSummary): MailMessageSnapshot {
  return {
    id: message.key,
    receivedAt: message.receivedAt ?? 0,
    sender: message.sender,
    subject: message.subject,
    bodyPreview: message.preview,
    bodyText: message.preview
  }
}

describe('Inboxes headless fallback message identity', () => {
  it('preserves rendered row content instead of collapsing preview to subject-only', () => {
    const subject = 'Microsoft account security code'
    const preview = inboxesMessageRowPreview(
      '',
      ['Microsoft account team', `${subject} 777777`, 'A few seconds ago'],
      subject
    )

    expect(preview).toContain('777777')
    expect(preview).not.toBe(subject)
  })

  it('distinguishes consecutive Microsoft code messages even when the legacy fallback key collides', () => {
    const first = fallbackMessage('111111', 'A few seconds ago', 1_000_000)
    const second = fallbackMessage('222222', 'A few seconds ago', 1_001_000)

    const firstKey = createInboxesStableMessageKey(first)
    const secondKey = createInboxesStableMessageKey(second)

    expect(first.key).toBe(second.key)
    expect(firstKey).not.toBe(secondKey)
    expect(firstKey).toMatch(/^rowhash:[a-f0-9]{24}$/)
    expect(secondKey).toMatch(/^rowhash:[a-f0-9]{24}$/)
    expect(firstKey).not.toContain('111111')
    expect(secondKey).not.toContain('222222')
  })

  it('keeps one message identity stable when only the relative Received label ages', () => {
    const fresh = fallbackMessage('333333', 'A few seconds ago', 2_000_000)
    const aged = fallbackMessage('333333', '5 secs ago', 2_000_000)

    expect(createInboxesStableMessageKey(aged)).toBe(createInboxesStableMessageKey(fresh))
  })

  it('preserves provider-owned href/data/id identities unchanged', () => {
    const message = fallbackMessage('444444', 'A few seconds ago', 3_000_000)

    expect(createInboxesStableMessageKey({ ...message, key: 'href:/mail/123' })).toBe('href:/mail/123')
    expect(createInboxesStableMessageKey({ ...message, key: 'data:abc' })).toBe('data:abc')
    expect(createInboxesStableMessageKey({ ...message, key: 'id:xyz' })).toBe('id:xyz')
  })

  it('does not exclude the fresh second-round code when its legacy row key matches round one', async () => {
    const now = 4_002_000
    const first = fallbackMessage('555555', 'A few seconds ago', 4_000_000)
    const second = fallbackMessage('666666', 'A few seconds ago', 4_001_000)
    let messages: InboxesMessageSummary[] = [first]
    const readMessage = vi.fn(async (message: InboxesMessageSummary) => snapshot(message))
    const driver: InboxesMailboxDriver = {
      ensureMailbox: async (mailbox) => ({ status: 'ready', activeMailbox: mailbox }),
      listMessages: async () => messages,
      readMessage,
      refreshMailbox: async () => undefined
    }
    const provider = new InboxesProvider(driver, { now: () => now })

    const baseline = await provider.snapshotMessageKeys!({
      mailbox: 'owner@getnada.com',
      role: 'recovery',
      purpose: 'microsoft_security'
    })
    expect(baseline.status).toBe('success')
    expect(baseline.messageKeys).toEqual([createInboxesStableMessageKey(first)])

    messages = [second, first]
    const result = await provider.getVerificationCode({
      mailbox: 'owner@getnada.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      notBefore: 3_999_000,
      excludedMessageKeys: baseline.messageKeys,
      timeoutMs: 0
    })

    expect(result.status).toBe('success')
    expect(result.code).toBe('666666')
    expect(result.messageKey).toBe(createInboxesStableMessageKey(second))
    expect(result.messageKey).not.toBe(baseline.messageKeys[0])
    expect(readMessage).toHaveBeenCalledTimes(1)
  })
})
