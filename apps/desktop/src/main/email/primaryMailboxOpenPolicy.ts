import type { MailProviderId } from './mailProvider'
import { resolveMailProviderId } from './mailProviderRegistry'

export type PrimaryMailboxOpenRoute =
  | { kind: 'microsoft'; providerId: 'microsoft' }
  | { kind: 'browser_provider'; providerId: 'inboxes' | 'fvia_inboxes' }
  | { kind: 'unsupported'; providerId: MailProviderId | null }

/**
 * Manual `Mở mail` routing is based only on the canonical primary Account.email.
 * Recovery mailbox routing remains a separate contract and must never call this
 * helper with backupEmail.
 */
export function resolvePrimaryMailboxOpenRoute(primaryEmail: string | null | undefined): PrimaryMailboxOpenRoute {
  const providerId = primaryEmail ? resolveMailProviderId(primaryEmail) : null
  if (providerId === 'microsoft') return { kind: 'microsoft', providerId }
  if (providerId === 'inboxes' || providerId === 'fvia_inboxes') {
    return { kind: 'browser_provider', providerId }
  }
  return { kind: 'unsupported', providerId }
}

export function primaryMailboxProviderLabel(providerId: MailProviderId | null): string {
  if (providerId === 'microsoft') return 'Microsoft/Outlook'
  if (providerId === 'inboxes') return 'Inboxes'
  if (providerId === 'fvia_inboxes') return 'FviaInboxes'
  if (providerId === 'mailto_plus') return 'TempMail.Plus'
  if (providerId === 'gmail') return 'Gmail'
  if (providerId === 'yahoo') return 'Yahoo'
  return 'provider chưa hỗ trợ'
}
