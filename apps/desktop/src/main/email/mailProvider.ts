export const MAIL_PROVIDER_IDS = ['microsoft', 'inboxes', 'fvia_inboxes', 'mailto_plus', 'gmail', 'yahoo'] as const
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

/**
 * Provider-neutral mailbox-code request used at the Mailbox Router/coordinator boundary.
 *
 * accountId is the canonical account handle required by mailbox implementations that
 * resolve credentials/state from account-scoped storage (for example Microsoft OAuth).
 * Provider-specific DOM, page lifecycle and retry behavior must not leak into this type.
 */
export interface MailboxCodeRequest {
  accountId: number
  mailbox: string
  role: MailboxRole
  purpose: MailCodePurpose
  challengeId: string
  /** Earliest acceptable provider message timestamp for this challenge. */
  notBefore?: number
  /** Message identities present before the current challenge was requested. */
  baselineMessageKeys?: readonly string[]
  /** Message identities already submitted/consumed by the durable auth session. */
  consumedMessageKeys?: readonly string[]
  timeoutMs?: number
  pollIntervalMs?: number
}

export interface MailProviderCodeRequest {
  mailbox: string
  role: MailboxRole
  purpose: MailCodePurpose
  /** Earliest acceptable provider message timestamp for this verification request. */
  notBefore?: number
  /** Message keys that must be rejected before candidate selection/open. */
  excludedMessageKeys?: readonly string[]
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

/** Provider-neutral result keeps the challenge identity across module boundaries. */
export interface MailboxCodeResult extends MailProviderCodeResult {
  challengeId: string
}

export interface MailProviderMessageKeySnapshotRequest {
  mailbox: string
  role: MailboxRole
  purpose: MailCodePurpose
}

export interface MailProviderMessageKeySnapshotResult {
  providerId: MailProviderId
  mailbox: string
  status: MailProviderResultStatus
  messageKeys: readonly string[]
  message: string
}

export interface MailProvider {
  readonly id: MailProviderId
  getVerificationCode(request: MailProviderCodeRequest): Promise<MailProviderCodeResult>
  /** Optional browser-provider capability used to baseline message identity before a new challenge is sent. */
  snapshotMessageKeys?(request: MailProviderMessageKeySnapshotRequest): Promise<MailProviderMessageKeySnapshotResult>
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
