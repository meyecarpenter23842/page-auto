export const EMAIL_CODE_CONSUMERS = ['manual', 'facebook_login'] as const
export type EmailCodeConsumer = (typeof EMAIL_CODE_CONSUMERS)[number]

export const EMAIL_CODE_FAILURE_STATUSES = [
  'email_auth_missing',
  'email_auth_expired',
  'email_code_not_found',
  'email_support_error'
] as const
export type EmailCodeFailureStatus = (typeof EMAIL_CODE_FAILURE_STATUSES)[number]
export type EmailCodeStatus = 'success' | EmailCodeFailureStatus

export const EMAIL_CODE_DB_RETENTION_MS = 10 * 60_000
export const FACEBOOK_EMAIL_CODE_TIMEOUT_MS = 15_000

export interface EmailCodeRequest {
  accountId: number
  consumer: EmailCodeConsumer
  /** Reject mailbox messages received before this timestamp. */
  notBefore?: number
  /** Bounded polling window. Manual reads normally use 0; Facebook may wait briefly for a new mail. */
  timeoutMs?: number
}

export interface EmailCodeResult {
  accountId: number
  status: EmailCodeStatus
  code: string | null
  receivedAt: number | null
  sender: string | null
  message: string
}

export interface EmailCodeProvider {
  getEmailCode(request: EmailCodeRequest): Promise<EmailCodeResult>
}

export interface EmailCodeWorkerRequestMessage {
  type: 'email_code_request'
  requestId: string
  request: EmailCodeRequest
}

export interface EmailCodeWorkerResponseMessage {
  type: 'email_code_response'
  requestId: string
  result: EmailCodeResult
}
