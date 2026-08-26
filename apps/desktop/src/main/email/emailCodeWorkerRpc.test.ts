import { describe, expect, it, vi } from 'vitest'
import type { EmailCodeWorkerRequestMessage } from '../../shared/emailCode'
import { createEmailCodeWorkerRpc } from './emailCodeWorkerRpc'

describe('EmailCode worker RPC', () => {
  it('sends only the typed EmailCode request and routes the matching response', async () => {
    const sent: EmailCodeWorkerRequestMessage[] = []
    const rpc = createEmailCodeWorkerRpc((message) => { sent.push(message) })
    const promise = rpc.provider.getEmailCode({
      accountId: 8,
      consumer: 'facebook_login',
      notBefore: 123,
      timeoutMs: 5_000
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.request).toEqual({ accountId: 8, consumer: 'facebook_login', notBefore: 123, timeoutMs: 5_000 })
    const serialized = JSON.stringify(sent[0])
    expect(serialized).not.toMatch(/refresh|token|profile|proxy|password/i)

    rpc.handleMessage({
      type: 'email_code_response',
      requestId: sent[0]!.requestId,
      result: {
        accountId: 8,
        status: 'success',
        code: '123456',
        receivedAt: 456,
        sender: 'security@facebookmail.com',
        message: 'Email Support Service đã nhận mã Facebook mới.'
      }
    })

    await expect(promise).resolves.toMatchObject({ status: 'success', code: '123456' })
    rpc.dispose()
  })

  it('fails closed when the bridge is disposed while a request is pending', async () => {
    const send = vi.fn()
    const rpc = createEmailCodeWorkerRpc(send)
    const promise = rpc.provider.getEmailCode({ accountId: 3, consumer: 'facebook_login', timeoutMs: 15_000 })
    rpc.dispose()
    await expect(promise).resolves.toMatchObject({ accountId: 3, status: 'email_support_error', code: null })
  })
})
