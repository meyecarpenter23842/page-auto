export const MAIL_PROVIDER_IDS = ['microsoft', 'inboxes', 'mailto_plus', 'gmail', 'yahoo'] as const
export type MailProviderId = (typeof MAIL_PROVIDER_IDS)[number]

export const MAILBOX_ROLES = ['primary', 'recovery'] as const
export type MailboxRole = (typeof MAILBOX_ROLES)[number]

export const MAIL_CODE_PURPOSES = ['microsoft_security', 'generic_verification'] as const
export type MailCodePurpose = (typeof MAIL_CODE_PURPOSES)[number]

export const MAIL_PROVIDER_RESULT_STATUSES = [
  'success',
  'unsupported_mailbox',
  'mailbox_not_found',
  'message_not_found',
  'timeout',
  'provider_unavailable'
] as const
export type MailProviderResultStatus = (typeof MAIL_PROVIDER_RESULT_STATUSES)[number]

export interface MailProviderCodeRequest {
  mailbox: string
  role: MailboxRole
  purpose: MailCodePurpose
  /** Earliest acceptable provider message timestamp for this verification request. */
  notBefore?: number
  timeoutMs?: number
  pollIntervalMs?: number
}

export interface MailProviderCodeResult {
  providerId: MailProviderId
  mailbox: string
  status: MailProviderResultStatus
  code: string | null
  sender: string | null
  messageKey: string | null
  message: string
}

export interface MailProvider {
  readonly id: MailProviderId
  getVerificationCode(request: MailProviderCodeRequest): Promise<MailProviderCodeResult>
}

export function normalizeMailboxAddress(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  const separator = normalized.lastIndexOf('@')
  if (separator <= 0 || separator === normalized.length - 1) return null
  const local = normalized.slice(0, separator).trim()
  const domain = normalized.slice(separator + 1).trim().replace(/\.+$/, '')
  if (!local || !domain || /\s/.test(local) || /\s/.test(domain) || !domain.includes('.')) return null
  return `${local}@${domain}`
}
