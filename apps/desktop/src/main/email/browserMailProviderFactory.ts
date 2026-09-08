import type { Page } from 'playwright-core'
import type { MailProvider, MailProviderId } from './mailProvider'
import { FviaInboxesPlaywrightDriver } from './fviaInboxesPlaywrightDriver'
import { FviaInboxesProvider } from './fviaInboxesProvider'
import { InboxesPlaywrightDriver } from './inboxesPlaywrightDriver'
import { InboxesProvider } from './inboxesProvider'
import { MailtoPlusApiDriver } from './mailtoPlusApiDriver'
import { MailtoPlusProvider } from './mailtoPlusProvider'

export type BrowserMailProviderId = 'inboxes' | 'fvia_inboxes' | 'mailto_plus'

export function isBrowserMailProviderId(providerId: MailProviderId | null): providerId is BrowserMailProviderId {
  return providerId === 'inboxes' || providerId === 'fvia_inboxes' || providerId === 'mailto_plus'
}

export function createBrowserMailProvider(providerId: MailProviderId, page: Page): MailProvider | null {
  if (providerId === 'inboxes') return new InboxesProvider(new InboxesPlaywrightDriver(page))
  if (providerId === 'fvia_inboxes') return new FviaInboxesProvider(new FviaInboxesPlaywrightDriver(page))
  if (providerId === 'mailto_plus') return new MailtoPlusProvider(new MailtoPlusApiDriver(page))
  return null
}
