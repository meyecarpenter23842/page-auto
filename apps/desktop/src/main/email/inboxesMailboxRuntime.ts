import type { Page } from 'playwright-core'
import { InboxesBackgroundPlaywrightDriver, isInboxesProviderPageUrl } from './inboxesBackgroundPlaywrightDriver'
import { InboxesProvider } from './inboxesProvider'
import { InboxesVisibleCodeFallbackDriver } from './inboxesVisibleCodeFallbackDriver'
import {
  closeUnexpectedInboxesPopupPages,
  dismissInboxesGoogleVignette,
  hasInboxesProviderEscaped,
  snapshotInboxesContextPages
} from './inboxesVignetteGuard'
import {
  normalizeMailboxAddress,
  type MailProvider,
  type MailProviderCodeRequest,
  type MailProviderCodeResult,
  type MailProviderMessageKeySnapshotRequest,
  type MailProviderMessageKeySnapshotResult
} from './mailProvider'

const MAX_PROVIDER_RELOAD_RECOVERIES = 1
const PROVIDER_RELOAD_TIMEOUT_MS = 10_000
const INBOXES_HOME_URL = 'https://inboxes.com/'

export interface InboxesMailboxRuntime {
  page: Page
  provider: MailProvider
  isReusablePageUrl: (value: string) => boolean
}

export interface CreateInboxesMailboxRuntimeOptions {
  preferredPage?: Page | null | undefined
  pages: readonly Page[]
  createPage: () => Promise<Page>
}

interface InboxesLifecycleProviderOptions {
  now?: () => number
  recreateProvider?: () => MailProvider
}

function normalizeRuntimeMailbox(value: string): string {
  return normalizeMailboxAddress(value) ?? value.trim().toLowerCase()
}

function codeFailure(request: MailProviderCodeRequest, message: string): MailProviderCodeResult {
  return {
    providerId: 'inboxes',
    mailbox: normalizeRuntimeMailbox(request.mailbox),
    status: 'provider_unavailable',
    code: null,
    sender: null,
    messageKey: null,
    message
  }
}

function snapshotFailure(
  request: MailProviderMessageKeySnapshotRequest,
  message: string
): MailProviderMessageKeySnapshotResult {
  return {
    providerId: 'inboxes',
    mailbox: normalizeRuntimeMailbox(request.mailbox),
    status: 'provider_unavailable',
    messageKeys: [],
    message
  }
}

async function recoverInboxesProviderPage(page: Page, remainingMs: number): Promise<void> {
  if (page.isClosed() || remainingMs <= 0) return
  const options = {
    waitUntil: 'domcontentloaded' as const,
    timeout: Math.max(1, Math.min(PROVIDER_RELOAD_TIMEOUT_MS, remainingMs))
  }

  try {
    if (hasInboxesProviderEscaped(page)) {
      await page.goto(INBOXES_HOME_URL, options)
    } else {
      await page.reload(options)
    }
  } catch {
    // Keep the same explicitly owned provider page as the recovery target.
  }
}

export function newestOpenInboxesProviderPage(pages: readonly Page[]): Page | null {
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const page = pages[index]
    if (page && !page.isClosed() && isInboxesProviderPageUrl(page.url())) return page
  }
  return null
}

export function ownedOrNewestOpenInboxesProviderPage(
  ownedPage: Page | null | undefined,
  pages: readonly Page[]
): Page | null {
  if (ownedPage && !ownedPage.isClosed()) return ownedPage
  return newestOpenInboxesProviderPage(pages)
}

/**
 * Inboxes-owned lifecycle wrapper. Common mailbox orchestration only sees the
 * MailProvider contract; popup/vignette/URL/reload policy stays inside this module.
 */
export class InboxesLifecycleProvider implements MailProvider {
  readonly id = 'inboxes' as const
  private readonly now: () => number
  private provider: MailProvider
  private readonly recreateProvider: () => MailProvider

  constructor(
    private readonly page: Page,
    provider: MailProvider,
    options: InboxesLifecycleProviderOptions = {}
  ) {
    this.provider = provider
    this.now = options.now ?? Date.now
    this.recreateProvider = options.recreateProvider ?? (() => this.provider)
  }

  async snapshotMessageKeys(
    request: MailProviderMessageKeySnapshotRequest
  ): Promise<MailProviderMessageKeySnapshotResult> {
    const vignetteState = await dismissInboxesGoogleVignette(this.page)
    if (vignetteState === 'blocked') {
      return snapshotFailure(request, 'Google vignette trên Inboxes đang chặn baseline trước Send code.')
    }

    const snapshot = this.provider.snapshotMessageKeys
    if (!snapshot) {
      return snapshotFailure(request, 'Inboxes provider hiện tại không hỗ trợ baseline message identity.')
    }

    const pagesBefore = snapshotInboxesContextPages(this.page)
    let result: MailProviderMessageKeySnapshotResult
    try {
      result = await snapshot.call(this.provider, request)
    } catch {
      return snapshotFailure(request, 'Không snapshot được message identity từ Inboxes trước Send code.')
    }

    const unexpectedPopupCount = await closeUnexpectedInboxesPopupPages(this.page, pagesBefore)
    if (unexpectedPopupCount > 0 || hasInboxesProviderEscaped(this.page) || this.page.isClosed()) {
      return snapshotFailure(request, 'Inboxes đổi/đóng provider page trong lúc baseline trước Send code.')
    }
    return result
  }

  async getVerificationCode(request: MailProviderCodeRequest): Promise<MailProviderCodeResult> {
    const timeoutMs = request.timeoutMs === undefined ? 0 : Math.max(0, request.timeoutMs)
    const deadline = this.now() + timeoutMs
    let reloadRecoveries = 0

    while (true) {
      const vignetteState = await dismissInboxesGoogleVignette(this.page)
      if (vignetteState === 'blocked') {
        const remainingMs = deadline - this.now()
        if (timeoutMs === 0 || remainingMs <= 0 || reloadRecoveries >= MAX_PROVIDER_RELOAD_RECOVERIES) {
          return codeFailure(request, 'Google vignette trên Inboxes đang chặn thao tác và không đóng được bằng Close đã audit.')
        }
        reloadRecoveries += 1
        await recoverInboxesProviderPage(this.page, remainingMs)
        this.provider = this.recreateProvider()
        if (this.now() >= deadline) {
          return codeFailure(request, 'Google vignette trên Inboxes vẫn chặn sau recovery có giới hạn.')
        }
        continue
      }

      const pagesBefore = snapshotInboxesContextPages(this.page)
      const remainingMs = Math.max(0, deadline - this.now())
      const result = await this.provider.getVerificationCode({
        ...request,
        timeoutMs: timeoutMs === 0 ? 0 : remainingMs
      })

      const unexpectedPopupCount = await closeUnexpectedInboxesPopupPages(this.page, pagesBefore)
      const providerEscaped = hasInboxesProviderEscaped(this.page)
      if (unexpectedPopupCount > 0 || providerEscaped) {
        const recoveryRemainingMs = deadline - this.now()
        if (timeoutMs === 0 || recoveryRemainingMs <= 0 || reloadRecoveries >= MAX_PROVIDER_RELOAD_RECOVERIES) {
          return codeFailure(
            request,
            providerEscaped
              ? 'Tab Inboxes bị điều hướng sang trang ngoài provider trong lúc đọc mail.'
              : 'Click Inboxes bị quảng cáo chặn và mở tab ngoài provider.'
          )
        }
        reloadRecoveries += 1
        await recoverInboxesProviderPage(this.page, recoveryRemainingMs)
        this.provider = this.recreateProvider()
        if (this.now() >= deadline) {
          return codeFailure(request, 'Inboxes không phục hồi kịp trong timeout sau khi quảng cáo chặn click.')
        }
        continue
      }

      if (result.status === 'provider_unavailable' && reloadRecoveries < MAX_PROVIDER_RELOAD_RECOVERIES) {
        const recoveryRemainingMs = deadline - this.now()
        if (timeoutMs === 0 || recoveryRemainingMs <= 0) return result

        reloadRecoveries += 1
        await recoverInboxesProviderPage(this.page, recoveryRemainingMs)
        this.provider = this.recreateProvider()
        if (this.now() >= deadline) return result
        continue
      }

      return result
    }
  }
}

export async function createInboxesMailboxRuntime(
  options: CreateInboxesMailboxRuntimeOptions
): Promise<InboxesMailboxRuntime | null> {
  const page = ownedOrNewestOpenInboxesProviderPage(options.preferredPage, options.pages)
    ?? await options.createPage()
  if (page.isClosed()) return null

  const createProvider = (): MailProvider => new InboxesProvider(new InboxesVisibleCodeFallbackDriver(
    page,
    new InboxesBackgroundPlaywrightDriver(page)
  ))
  const provider = new InboxesLifecycleProvider(
    page,
    createProvider(),
    { recreateProvider: createProvider }
  )

  return {
    page,
    provider,
    isReusablePageUrl: isInboxesProviderPageUrl
  }
}
