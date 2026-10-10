import type {
  MailProvider,
  MailProviderCodeRequest,
  MailProviderCodeResult,
  MailProviderId,
  MailProviderMessageKeySnapshotRequest,
  MailProviderMessageKeySnapshotResult,
  MailProviderResumeFreshness
} from './mailProvider'

export type MailboxProviderWorkerOperation = 'get_verification_code' | 'snapshot_message_keys'

export type MailboxProviderWorkerRequestMessage =
  | {
      type: 'mailbox_provider_request'
      requestId: string
      accountId: number
      providerId: MailProviderId
      operation: 'get_verification_code'
      request: MailProviderCodeRequest
    }
  | {
      type: 'mailbox_provider_request'
      requestId: string
      accountId: number
      providerId: MailProviderId
      operation: 'snapshot_message_keys'
      request: MailProviderMessageKeySnapshotRequest
    }

export type MailboxProviderWorkerResponseMessage =
  | {
      type: 'mailbox_provider_response'
      requestId: string
      providerId: MailProviderId
      operation: 'get_verification_code'
      result: MailProviderCodeResult
    }
  | {
      type: 'mailbox_provider_response'
      requestId: string
      providerId: MailProviderId
      operation: 'snapshot_message_keys'
      result: MailProviderMessageKeySnapshotResult
    }

export type MailboxProviderWorkerRequestHandler = (
  request: MailboxProviderWorkerRequestMessage
) => Promise<MailboxProviderWorkerResponseMessage>

function unwrapMessage(value: unknown): unknown {
  return value && typeof value === 'object' && 'data' in value
    ? (value as { data?: unknown }).data
    : value
}

export function isMailboxProviderWorkerRequestMessage(value: unknown): value is MailboxProviderWorkerRequestMessage {
  const message = unwrapMessage(value)
  if (!message || typeof message !== 'object') return false
  const candidate = message as Partial<MailboxProviderWorkerRequestMessage>
  return candidate.type === 'mailbox_provider_request'
    && typeof candidate.requestId === 'string'
    && typeof candidate.accountId === 'number'
    && typeof candidate.providerId === 'string'
    && (candidate.operation === 'get_verification_code' || candidate.operation === 'snapshot_message_keys')
    && Boolean(candidate.request)
}

export function isMailboxProviderWorkerResponseMessage(value: unknown): value is MailboxProviderWorkerResponseMessage {
  const message = unwrapMessage(value)
  if (!message || typeof message !== 'object') return false
  const candidate = message as Partial<MailboxProviderWorkerResponseMessage>
  return candidate.type === 'mailbox_provider_response'
    && typeof candidate.requestId === 'string'
    && typeof candidate.providerId === 'string'
    && (candidate.operation === 'get_verification_code' || candidate.operation === 'snapshot_message_keys')
    && Boolean(candidate.result)
}

function codeUnavailable(
  providerId: MailProviderId,
  mailbox: string,
  message: string
): MailProviderCodeResult {
  return {
    providerId,
    mailbox,
    status: 'provider_unavailable',
    code: null,
    sender: null,
    messageKey: null,
    message
  }
}

function snapshotUnavailable(
  providerId: MailProviderId,
  mailbox: string,
  message: string
): MailProviderMessageKeySnapshotResult {
  return {
    providerId,
    mailbox,
    status: 'provider_unavailable',
    messageKeys: [],
    message
  }
}

export function mailboxProviderUnavailableResponse(
  request: MailboxProviderWorkerRequestMessage,
  message: string
): MailboxProviderWorkerResponseMessage {
  if (request.operation === 'get_verification_code') {
    return {
      type: 'mailbox_provider_response',
      requestId: request.requestId,
      providerId: request.providerId,
      operation: request.operation,
      result: codeUnavailable(request.providerId, request.request.mailbox, message)
    }
  }
  return {
    type: 'mailbox_provider_response',
    requestId: request.requestId,
    providerId: request.providerId,
    operation: request.operation,
    result: snapshotUnavailable(request.providerId, request.request.mailbox, message)
  }
}

export function mailboxProviderWorkerResponse(
  request: Extract<MailboxProviderWorkerRequestMessage, { operation: 'get_verification_code' }>,
  result: MailProviderCodeResult
): MailboxProviderWorkerResponseMessage
export function mailboxProviderWorkerResponse(
  request: Extract<MailboxProviderWorkerRequestMessage, { operation: 'snapshot_message_keys' }>,
  result: MailProviderMessageKeySnapshotResult
): MailboxProviderWorkerResponseMessage
export function mailboxProviderWorkerResponse(
  request: MailboxProviderWorkerRequestMessage,
  result: MailProviderCodeResult | MailProviderMessageKeySnapshotResult
): MailboxProviderWorkerResponseMessage {
  return {
    type: 'mailbox_provider_response',
    requestId: request.requestId,
    providerId: request.providerId,
    operation: request.operation,
    result
  } as MailboxProviderWorkerResponseMessage
}

type PendingRequest =
  | {
      kind: 'code'
      providerId: MailProviderId
      mailbox: string
      operation: 'get_verification_code'
      resolve: (result: MailProviderCodeResult) => void
      timer: ReturnType<typeof setTimeout>
    }
  | {
      kind: 'snapshot'
      providerId: MailProviderId
      mailbox: string
      operation: 'snapshot_message_keys'
      resolve: (result: MailProviderMessageKeySnapshotResult) => void
      timer: ReturnType<typeof setTimeout>
    }

export interface MailboxProviderWorkerRpc {
  createProvider: (
    providerId: MailProviderId,
    accountId: number,
    resumeFreshness?: MailProviderResumeFreshness
  ) => MailProvider
  handleMessage: (value: unknown) => boolean
  dispose: () => void
}

let requestSequence = 0

function rpcTimeoutMs(providerTimeoutMs: number | undefined): number {
  const providerTimeout = providerTimeoutMs === undefined || !Number.isFinite(providerTimeoutMs)
    ? 20_000
    : Math.max(0, Math.floor(providerTimeoutMs))
  return Math.max(5_000, Math.min(70_000, providerTimeout + 5_000))
}

export function createMailboxProviderWorkerRpc(
  send: (message: MailboxProviderWorkerRequestMessage) => void
): MailboxProviderWorkerRpc {
  const pending = new Map<string, PendingRequest>()
  let disposed = false

  const nextRequestId = (): string => {
    requestSequence += 1
    return `mailbox-provider-${Date.now()}-${requestSequence}`
  }

  const requestCode = (
    accountId: number,
    providerId: MailProviderId,
    request: MailProviderCodeRequest
  ): Promise<MailProviderCodeResult> => {
    if (disposed) {
      return Promise.resolve(codeUnavailable(providerId, request.mailbox, 'Mailbox provider RPC đã đóng.'))
    }

    return new Promise<MailProviderCodeResult>((resolve) => {
      const requestId = nextRequestId()
      const timer = setTimeout(() => {
        pending.delete(requestId)
        resolve(codeUnavailable(providerId, request.mailbox, 'Mailbox provider RPC quá thời gian chờ Main phản hồi.'))
      }, rpcTimeoutMs(request.timeoutMs))
      pending.set(requestId, {
        kind: 'code',
        providerId,
        mailbox: request.mailbox,
        operation: 'get_verification_code',
        resolve,
        timer
      })
      try {
        send({
          type: 'mailbox_provider_request',
          requestId,
          accountId,
          providerId,
          operation: 'get_verification_code',
          request
        })
      } catch {
        clearTimeout(timer)
        pending.delete(requestId)
        resolve(codeUnavailable(providerId, request.mailbox, 'Không gửi được mailbox provider request về Main.'))
      }
    })
  }

  const requestSnapshot = (
    accountId: number,
    providerId: MailProviderId,
    request: MailProviderMessageKeySnapshotRequest
  ): Promise<MailProviderMessageKeySnapshotResult> => {
    if (disposed) {
      return Promise.resolve(snapshotUnavailable(providerId, request.mailbox, 'Mailbox provider RPC đã đóng.'))
    }

    return new Promise<MailProviderMessageKeySnapshotResult>((resolve) => {
      const requestId = nextRequestId()
      const timer = setTimeout(() => {
        pending.delete(requestId)
        resolve(snapshotUnavailable(providerId, request.mailbox, 'Mailbox provider RPC quá thời gian chờ Main phản hồi.'))
      }, 25_000)
      pending.set(requestId, {
        kind: 'snapshot',
        providerId,
        mailbox: request.mailbox,
        operation: 'snapshot_message_keys',
        resolve,
        timer
      })
      try {
        send({
          type: 'mailbox_provider_request',
          requestId,
          accountId,
          providerId,
          operation: 'snapshot_message_keys',
          request
        })
      } catch {
        clearTimeout(timer)
        pending.delete(requestId)
        resolve(snapshotUnavailable(providerId, request.mailbox, 'Không gửi được mailbox baseline request về Main.'))
      }
    })
  }

  return {
    createProvider: (providerId, accountId, resumeFreshness) => ({
      id: providerId,
      ...(resumeFreshness ? { resumeFreshness } : {}),
      getVerificationCode: async (request) => await requestCode(accountId, providerId, request),
      snapshotMessageKeys: async (request) => await requestSnapshot(accountId, providerId, request)
    }),
    handleMessage: (value) => {
      const raw = unwrapMessage(value)
      if (!isMailboxProviderWorkerResponseMessage(raw)) return false
      const message = raw as MailboxProviderWorkerResponseMessage
      const item = pending.get(message.requestId)
      if (!item) return true
      if (item.providerId !== message.providerId || item.operation !== message.operation) return true
      pending.delete(message.requestId)
      clearTimeout(item.timer)
      if (item.kind === 'code' && message.operation === 'get_verification_code') {
        item.resolve(message.result)
      } else if (item.kind === 'snapshot' && message.operation === 'snapshot_message_keys') {
        item.resolve(message.result)
      }
      return true
    },
    dispose: () => {
      disposed = true
      for (const item of pending.values()) {
        clearTimeout(item.timer)
        if (item.kind === 'code') {
          item.resolve(codeUnavailable(item.providerId, item.mailbox, 'Mailbox provider RPC đã đóng khi request còn chờ.'))
        } else {
          item.resolve(snapshotUnavailable(item.providerId, item.mailbox, 'Mailbox provider RPC đã đóng khi request còn chờ.'))
        }
      }
      pending.clear()
    }
  }
}
