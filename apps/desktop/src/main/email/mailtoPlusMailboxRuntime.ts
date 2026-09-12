import type { Page } from 'playwright-core'
import { MailtoPlusApiDriver } from './mailtoPlusApiDriver'
import { MailtoPlusProvider } from './mailtoPlusProvider'
import type { MailProvider } from './mailProvider'

export interface MailtoPlusMailboxRuntime {
  page: Page
  provider: MailProvider
  isReusablePageUrl: (value: string) => boolean
}

export interface CreateMailtoPlusMailboxRuntimeOptions {
  preferredPage?: Page | null | undefined
  pages: readonly Page[]
  createPage: () => Promise<Page>
}

export function isMailtoPlusProviderPageUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'tempmail.plus' || hostname.endsWith('.tempmail.plus')
  } catch {
    return false
  }
}

export function newestOpenMailtoPlusProviderPage(pages: readonly Page[]): Page | null {
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const page = pages[index]
    if (page && !page.isClosed() && isMailtoPlusProviderPageUrl(page.url())) return page
  }
  return null
}

export function ownedOrNewestOpenMailtoPlusProviderPage(
  ownedPage: Page | null | undefined,
  pages: readonly Page[]
): Page | null {
  if (ownedPage && !ownedPage.isClosed()) return ownedPage
  return newestOpenMailtoPlusProviderPage(pages)
}

export async function createMailtoPlusMailboxRuntime(
  options: CreateMailtoPlusMailboxRuntimeOptions
): Promise<MailtoPlusMailboxRuntime | null> {
  const page = ownedOrNewestOpenMailtoPlusProviderPage(options.preferredPage, options.pages)
    ?? await options.createPage()
  if (page.isClosed()) return null

  return {
    page,
    provider: new MailtoPlusProvider(new MailtoPlusApiDriver(page)),
    isReusablePageUrl: isMailtoPlusProviderPageUrl
  }
}
