import type { Page } from 'playwright-core'
import { FviaInboxesPlaywrightDriver } from './fviaInboxesPlaywrightDriver'
import { FviaInboxesProvider } from './fviaInboxesProvider'
import {
  normalizeMailboxAddress,
  type MailProvider,
  type MailProviderCodeRequest,
  type MailProviderCodeResult,
  type MailProviderMessageKeySnapshotRequest,
  type MailProviderMessageKeySnapshotResult
} from './mailProvider'

export interface FviaInboxesMailboxRuntime {
  page: Page
  provider: MailProvider
  isReusablePageUrl: (value: string) => boolean
}

export interface CreateFviaInboxesMailboxRuntimeOptions {
  preferredPage?: Page | null | undefined
  pages: readonly Page[]
  createPage: () => Promise<Page>
}

function normalizeRuntimeMailbox(value: string): string {
  return normalizeMailboxAddress(value) ?? value.trim().toLowerCase()
}

function snapshotFailure(
  request: MailProviderMessageKeySnapshotRequest,
  message: string
): MailProviderMessageKeySnapshotResult {
  return {
    providerId: 'fvia_inboxes',
    mailbox: normalizeRuntimeMailbox(request.mailbox),
    status: 'provider_unavailable',
    messageKeys: [],
    message
  }
}

export function isFviaInboxesProviderPageUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'fviainboxes.com' || hostname.endsWith('.fviainboxes.com')
  } catch {
    return false
  }
}

export function newestOpenFviaInboxesProviderPage(pages: readonly Page[]): Page | null {
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const page = pages[index]
    if (page && !page.isClosed() && isFviaInboxesProviderPageUrl(page.url())) return page
  }
  return null
}

export function ownedOrNewestOpenFviaInboxesProviderPage(
  ownedPage: Page | null | undefined,
  pages: readonly Page[]
): Page | null {
  if (ownedPage && !ownedPage.isClosed()) return ownedPage
  return newestOpenFviaInboxesProviderPage(pages)
}

/**
 * Fvia-owned lifecycle wrapper. Common mailbox orchestration only sees the
 * MailProvider contract; URL/page validation stays inside this provider module.
 */
export class FviaInboxesLifecycleProvider implements MailProvider {
  readonly id = 'fvia_inboxes' as const

  constructor(
    private readonly page: Page,
    private readonly provider: MailProvider
  ) {}

  async snapshotMessageKeys(
    request: MailProviderMessageKeySnapshotRequest
  ): Promise<MailProviderMessageKeySnapshotResult> {
    const snapshot = this.provider.snapshotMessageKeys
    if (!snapshot) {
      return snapshotFailure(request, 'FviaInboxes provider hiện tại không hỗ trợ baseline message identity.')
    }

    let result: MailProviderMessageKeySnapshotResult
    try {
      result = await snapshot.call(this.provider, request)
    } catch {
      return snapshotFailure(request, 'Không snapshot được message identity từ FviaInboxes trước Send code.')
    }

    if (this.page.isClosed() || !isFviaInboxesProviderPageUrl(this.page.url())) {
      return snapshotFailure(request, 'FviaInboxes đổi/đóng provider page trong lúc baseline trước Send code.')
    }

    return result
  }

  async getVerificationCode(request: MailProviderCodeRequest): Promise<MailProviderCodeResult> {
    return await this.provider.getVerificationCode(request)
  }
}

export async function createFviaInboxesMailboxRuntime(
  options: CreateFviaInboxesMailboxRuntimeOptions
): Promise<FviaInboxesMailboxRuntime | null> {
  const page = ownedOrNewestOpenFviaInboxesProviderPage(options.preferredPage, options.pages)
    ?? await options.createPage()
  if (page.isClosed()) return null

  const provider = new FviaInboxesLifecycleProvider(
    page,
    new FviaInboxesProvider(new FviaInboxesPlaywrightDriver(page))
  )

  return {
    page,
    provider,
    isReusablePageUrl: isFviaInboxesProviderPageUrl
  }
}
