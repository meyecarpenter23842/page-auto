import {
  BrowserMailboxProvider,
  type BrowserEnsureMailboxResult,
  type BrowserMailboxDriver,
  type BrowserMailboxMessageSummary,
  type BrowserMailboxProviderOptions
} from './browserMailboxProvider'
import { resolveMailProviderId } from './mailProviderRegistry'

export type InboxesMessageSummary = BrowserMailboxMessageSummary
export type InboxesEnsureMailboxResult = BrowserEnsureMailboxResult
export type InboxesMailboxDriver = BrowserMailboxDriver
export type InboxesProviderOptions = BrowserMailboxProviderOptions

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
}
