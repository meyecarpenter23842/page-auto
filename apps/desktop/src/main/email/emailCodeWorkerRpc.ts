import type {
  EmailCodeProvider,
  EmailCodeRequest,
  EmailCodeResult,
  EmailCodeWorkerRequestMessage,
  EmailCodeWorkerResponseMessage
} from '../../shared/emailCode'

interface PendingEmailCodeRequest {
  resolve: (result: EmailCodeResult) => void
  timer: NodeJS.Timeout
  accountId: number
}

function supportError(accountId: number, message: string): EmailCodeResult {
  return {
    accountId,
    status: 'email_support_error',
    code: null,
    receivedAt: null,
    sender: null,
    message
  }
}

export interface EmailCodeWorkerRpc {
  provider: EmailCodeProvider
  handleMessage: (payload: unknown) => boolean
  dispose: () => void
}

export function createEmailCodeWorkerRpc(
  send: (message: EmailCodeWorkerRequestMessage) => void
): EmailCodeWorkerRpc {
  const pending = new Map<string, PendingEmailCodeRequest>()
  let sequence = 0
  let disposed = false

  const provider: EmailCodeProvider = {
    getEmailCode: async (request: EmailCodeRequest): Promise<EmailCodeResult> => {
      if (disposed) return supportError(request.accountId, 'Email Support bridge đã đóng.')
      const requestId = `email-code-${process.pid}-${Date.now()}-${++sequence}`
      const bridgeTimeoutMs = Math.max(5_000, Math.min(30_000, (request.timeoutMs ?? 0) + 5_000))
      return await new Promise<EmailCodeResult>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(requestId)
          resolve(supportError(request.accountId, 'Email Support bridge quá thời gian phản hồi.'))
        }, bridgeTimeoutMs)
        pending.set(requestId, { resolve, timer, accountId: request.accountId })
        try {
          send({ type: 'email_code_request', requestId, request })
        } catch {
          clearTimeout(timer)
          pending.delete(requestId)
          resolve(supportError(request.accountId, 'Không gửi được yêu cầu tới Email Support Service.'))
        }
      })
    }
  }

  const handleMessage = (payload: unknown): boolean => {
    if (!payload || typeof payload !== 'object' || (payload as { type?: unknown }).type !== 'email_code_response') return false
    const message = payload as EmailCodeWorkerResponseMessage
    const item = pending.get(message.requestId)
    if (!item) return true
    pending.delete(message.requestId)
    clearTimeout(item.timer)
    item.resolve(message.result.accountId === item.accountId
      ? message.result
      : supportError(item.accountId, 'Email Support bridge trả kết quả sai account.'))
    return true
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    for (const [requestId, item] of pending) {
      clearTimeout(item.timer)
      item.resolve(supportError(item.accountId, 'Email Support bridge đã đóng.'))
      pending.delete(requestId)
    }
  }

  return { provider, handleMessage, dispose }
}
