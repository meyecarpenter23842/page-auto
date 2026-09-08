import {
  BrowserMailboxProvider,
  type BrowserEnsureMailboxResult,
  type BrowserMailboxDriver,
  type BrowserMailboxMessageSummary,
  type BrowserMailboxProviderOptions
} from './browserMailboxProvider'
import type { MailProviderCodeRequest, MailProviderCodeResult } from './mailProvider'
import { resolveMailProviderId } from './mailProviderRegistry'

export type InboxesMessageSummary = BrowserMailboxMessageSummary
export type InboxesEnsureMailboxResult = BrowserEnsureMailboxResult
export type InboxesMailboxDriver = BrowserMailboxDriver
export type InboxesProviderOptions = BrowserMailboxProviderOptions

/**
 * The Microsoft recovery flow calls one zero-timeout recovery probe before it
 * asks Microsoft to send a fresh code. Inboxes has trustworthy Received times,
 * so that probe must verify/open the mailbox without serially opening old mail.
 */
export function isInboxesRecoveryWarmProbe(request: MailProviderCodeRequest): boolean {
  return request.role === 'recovery'
    && request.purpose === 'microsoft_security'
    && request.timeoutMs === 0
    && request.notBefore === undefined
}

/**
 * One provider for every domain served by Inboxes.com.
 *
 * PRIMARY and RECOVERY callers share the same role-agnostic implementation.
 * The generic browser mailbox core owns polling, freshness and consumed-message
 * semantics; this class only binds the Inboxes domain family and label.
 */
export class InboxesProvider extends BrowserMailboxProvider<'inboxes'> {
  constructor(driver: InboxesMailboxDriver, options: InboxesProviderOptions = {}) {
    super(driver, {
      ...options,
      providerId: 'inboxes',
      providerLabel: 'Inboxes.com',
      supportsMailbox: (mailbox) => resolveMailProviderId(mailbox) === 'inboxes'
    })
  }

  async getVerificationCode(request: MailProviderCodeRequest): Promise<MailProviderCodeResult> {
    if (isInboxesRecoveryWarmProbe(request)) {
      // Keep the normal ensureMailbox/listMessages verification, but make every
      // existing timestamped message ineligible so the warm probe never opens
      // historical mail one-by-one before Microsoft Send code.
      return await super.getVerificationCode({
        ...request,
        notBefore: Number.MAX_SAFE_INTEGER
      })
    }
    return await super.getVerificationCode(request)
  }
}
