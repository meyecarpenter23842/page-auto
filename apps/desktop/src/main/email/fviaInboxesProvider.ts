import {
  BrowserMailboxProvider,
  type BrowserEnsureMailboxResult,
  type BrowserMailboxDriver,
  type BrowserMailboxMessageSummary,
  type BrowserMailboxProviderOptions
} from './browserMailboxProvider'
import { resolveMailProviderId } from './mailProviderRegistry'

export type FviaInboxesMessageSummary = BrowserMailboxMessageSummary
export type FviaInboxesEnsureMailboxResult = BrowserEnsureMailboxResult
export type FviaInboxesMailboxDriver = BrowserMailboxDriver
export type FviaInboxesProviderOptions = BrowserMailboxProviderOptions

/**
 * One provider for the domain family served by fviainboxes.com.
 *
 * The audited Fvia inbox list does not consistently expose a reliable received
 * timestamp. The shared core therefore records when each message key is first
 * observed. During Microsoft recovery, the pre-Send warm-up establishes the
 * baseline so only a newly appearing message can satisfy the post-Send request.
 */
export class FviaInboxesProvider extends BrowserMailboxProvider<'fvia_inboxes'> {
  readonly resumeFreshness = 'baseline_current' as const

  constructor(driver: FviaInboxesMailboxDriver, options: FviaInboxesProviderOptions = {}) {
    super(driver, {
      ...options,
      providerId: 'fvia_inboxes',
      providerLabel: 'FviaInboxes',
      supportsMailbox: (mailbox) => resolveMailProviderId(mailbox) === 'fvia_inboxes',
      useFirstSeenWhenTimestampMissing: true
    })
  }
}
