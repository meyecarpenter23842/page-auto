import { describe, expect, it } from 'vitest'
import type { MailboxProviderWorkerRequestMessage } from './mailboxProviderWorkerRpc'
import { createMailboxProviderWorkerRpc } from './mailboxProviderWorkerRpc'

describe('mailboxProviderWorkerRpc', () => {
  it('sends account/mailbox identity without OAuth secrets and routes code response', async () => {
    const sent: MailboxProviderWorkerRequestMessage[] = []
    const rpc = createMailboxProviderWorkerRpc((message) => { sent.push(message) })
    const provider = rpc.createProvider('microsoft', 42, 'lookback')

    const promise = provider.getVerificationCode({
      mailbox: 'backup@outlook.com',
      role: 'recovery',
      purpose: 'microsoft_security',
      excludedMessageKeys: ['used-1'],
      timeoutMs: 2_000
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      accountId: 42,
      providerId: 'microsoft',
      operation: 'get_verification_code',
      request: { mailbox: 'backup@outlook.com', excludedMessageKeys: ['used-1'] }
    })
    expect(JSON.stringify(sent[0])).not.toMatch(/refreshToken|accessToken|emailPassword|cookie/i)

    const request = sent[0]!
    rpc.handleMessage({
      type: 'mailbox_provider_response',
      requestId: request.requestId,
      providerId: 'microsoft',
      operation: 'get_verification_code',
      result: {
        providerId: 'microsoft',
        mailbox: 'backup@outlook.com',
        status: 'success',
        code: '654321',
        sender: 'verify@example.test',
        messageKey: 'graph-message-2',
        message: 'ok'
      }
    })

    await expect(promise).resolves.toMatchObject({ status: 'success', messageKey: 'graph-message-2' })
    rpc.dispose()
  })

  it('routes baseline snapshot response through the same provider-neutral bridge', async () => {
    const sent: MailboxProviderWorkerRequestMessage[] = []
    const rpc = createMailboxProviderWorkerRpc((message) => { sent.push(message) })
    const provider = rpc.createProvider('microsoft', 7, 'lookback')
    const promise = provider.snapshotMessageKeys!({
      mailbox: 'owner@hotmail.com',
      role: 'recovery',
      purpose: 'microsoft_security'
    })

    const request = sent[0]!
    rpc.handleMessage({
      type: 'mailbox_provider_response',
      requestId: request.requestId,
      providerId: 'microsoft',
      operation: 'snapshot_message_keys',
      result: {
        providerId: 'microsoft',
        mailbox: 'owner@hotmail.com',
        status: 'success',
        messageKeys: ['m1', 'm2'],
        message: 'ok'
      }
    })

    await expect(promise).resolves.toMatchObject({ status: 'success', messageKeys: ['m1', 'm2'] })
    rpc.dispose()
  })
})
