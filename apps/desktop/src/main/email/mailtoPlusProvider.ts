import {
  BrowserMailboxProvider,
  type BrowserMailboxDriver,
  type BrowserMailboxProviderOptions
} from './browserMailboxProvider'
import { resolveMailProviderId } from './mailProviderRegistry'

export type MailtoPlusMailboxDriver = BrowserMailboxDriver
export type MailtoPlusProviderOptions = BrowserMailboxProviderOptions

/**
 * TempMail.Plus provider for the mailto.plus production target.
 *
 * The public inbox API is read through a Playwright Page owned by the existing
 * Email BrowserContext. This keeps mailbox traffic on the Email profile/proxy
 * boundary instead of introducing a Main-process fetch that could bypass it.
 * The API does not expose a timestamp contract PAGE-AUTO can safely trust here,
 * so the shared provider core uses first-seen baselining for fresh-code rounds.
 */
export class MailtoPlusProvider extends BrowserMailboxProvider<'mailto_plus'> {
  constructor(driver: MailtoPlusMailboxDriver, options: MailtoPlusProviderOptions = {}) {
    super(driver, {
      ...options,
      providerId: 'mailto_plus',
      providerLabel: 'TempMail.Plus',
      supportsMailbox: (mailbox) => resolveMailProviderId(mailbox) === 'mailto_plus',
      useFirstSeenWhenTimestampMissing: true
    })
  }
}
