import { normalizeMailboxAddress, type MailProviderId } from './mailProvider'

export const INBOXES_DOMAINS = [
  'blondmail.com',
  'chapsmail.com',
  'clowmail.com',
  'dropjar.com',
  'fivermail.com',
  'getairmail.com',
  'getmule.com',
  'getnada.com',
  'gimpmail.com',
  'givmail.com',
  'guysmail.com',
  'inboxbear.com',
  'replyloop.com',
  'robot-mail.com',
  'tafmail.com',
  'temptami.com',
  'tupmail.com',
  'vomoto.com'
] as const

export const FVIA_INBOXES_DOMAINS = [
  'fviainboxes.com',
  'fviadropinbox.com',
  'fviamail.work',
  'dropinboxes.com',
  'titanads.email'
] as const

/**
 * P3 starts with the production target explicitly audited for TempMail.Plus.
 * Add sibling TempMail.Plus domains only after they are verified for the same provider contract.
 */
export const MAILTO_PLUS_DOMAINS = [
  'mailto.plus'
] as const

export const MICROSOFT_MAIL_DOMAINS = [
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com'
] as const

const DOMAIN_PROVIDER = new Map<string, MailProviderId>([
  ...MICROSOFT_MAIL_DOMAINS.map((domain) => [domain, 'microsoft'] as const),
  ...INBOXES_DOMAINS.map((domain) => [domain, 'inboxes'] as const),
  ...FVIA_INBOXES_DOMAINS.map((domain) => [domain, 'fvia_inboxes'] as const),
  ...MAILTO_PLUS_DOMAINS.map((domain) => [domain, 'mailto_plus'] as const)
])

export function mailDomainFromAddress(value: string): string | null {
  const mailbox = normalizeMailboxAddress(value)
  if (!mailbox) return null
  return mailbox.slice(mailbox.lastIndexOf('@') + 1)
}

export function resolveMailProviderId(value: string): MailProviderId | null {
  const domain = mailDomainFromAddress(value)
  return domain ? (DOMAIN_PROVIDER.get(domain) ?? null) : null
}

export function isKnownInboxesMailbox(value: string): boolean {
  return resolveMailProviderId(value) === 'inboxes'
}

export function isKnownFviaInboxesMailbox(value: string): boolean {
  return resolveMailProviderId(value) === 'fvia_inboxes'
}

export function mailProviderDomains(providerId: MailProviderId): readonly string[] {
  if (providerId === 'inboxes') return INBOXES_DOMAINS
  if (providerId === 'fvia_inboxes') return FVIA_INBOXES_DOMAINS
  if (providerId === 'mailto_plus') return MAILTO_PLUS_DOMAINS
  if (providerId === 'microsoft') return MICROSOFT_MAIL_DOMAINS
  return []
}
