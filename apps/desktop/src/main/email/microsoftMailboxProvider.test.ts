import { describe, expect, it, vi } from 'vitest'
import { MicrosoftMailboxProvider } from './microsoftMailboxProvider'
import type { MailMessageSnapshot } from './verificationCodeParser'

function message(id: string, code: string, receivedAt: number): MailMessageSnapshot {
  return {
    id,
    receivedAt,
    sender: 'verify@example.test',
    subject: 'Verification code',
    bodyPreview: `Verification code: ${code}`,
    bodyText: `Use verification code ${code}`
  }
}

describe('MicrosoftMailboxProvider', () => {
  it('uses Graph message id as messageKey and excludes consumed messages across recovery rounds', async () => {
    const now = 10_000
    const readMessages = vi.fn(async () => [
      message('message-new', '654321', now - 100),
      message('message-old', '123456', now - 200)
    ])
    const provider = new MicrosoftMailboxProvider({ mailbox: 'Owner@Outlook.com', readMessages, now: () => now })

    const result = await provider.getVerificationCode({
      mailbox: 'owner@outlook.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      excludedMessageKeys: ['message-old'],
      timeoutMs: 0
    })

    expect(result).toMatchObject({
      providerId: 'microsoft',
      mailbox: 'owner@outlook.com',
      status: 'success',
      code: '654321',
      messageKey: 'message-new'
    })
  })

  it('snapshots canonical Graph message ids without exposing message content', async () => {
    const provider = new MicrosoftMailboxProvider({
      mailbox: 'owner@hotmail.com',
      readMessages: async () => [
        message('graph-1', '111111', 9_000),
        message('graph-2', '222222', 9_500),
        message('graph-1', '111111', 9_000)
      ]
    })

    await expect(provider.snapshotMessageKeys!({
      mailbox: 'owner@hotmail.com',
      role: 'recovery',
      purpose: 'microsoft_security'
    })).resolves.toMatchObject({
      providerId: 'microsoft',
      status: 'success',
      messageKeys: ['graph-1', 'graph-2']
    })
  })

  it('fails closed when the canonical Graph mailbox cannot be read', async () => {
    const provider = new MicrosoftMailboxProvider({
      mailbox: 'owner@live.com',
      readMessages: async () => { throw new Error('mailbox unavailable') }
    })

    await expect(provider.getVerificationCode({
      mailbox: 'owner@live.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 0
    })).resolves.toMatchObject({ status: 'provider_unavailable', code: null, messageKey: null })
  })

  it('rejects a request for a different Microsoft mailbox than the bound OAuth owner', async () => {
    const provider = new MicrosoftMailboxProvider({
      mailbox: 'a@outlook.com',
      readMessages: async () => []
    })

    await expect(provider.getVerificationCode({
      mailbox: 'b@outlook.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 0
    })).resolves.toMatchObject({ status: 'unsupported_mailbox' })
  })
})
