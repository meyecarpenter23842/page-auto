import type { BrowserContext, Page } from 'playwright-core'
import { EmailPageRegistry } from './emailPageRegistry'
import { InboxesProvider } from './inboxesProvider'
import { InboxesBackgroundPlaywrightDriver, isInboxesProviderPageUrl } from './inboxesBackgroundPlaywrightDriver'
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
  type MailProviderCodeResult,
  type MailProviderId,
  type MailProviderResultStatus
} from './mailProvider'
import { resolveMailProviderId } from './mailProviderRegistry'

const DEFAULT_TIMEOUT_MS = 20_000
const MAX_TIMEOUT_MS = 60_000
const MAX_CONSUMED_SKIPS = 100
const MAX_CLOSED_PAGE_RECOVERIES = 1
const MAX_PROVIDER_RELOAD_RECOVERIES = 1
const PROVIDER_RELOAD_TIMEOUT_MS = 10_000
const INBOXES_HOME_URL = 'https://inboxes.com/'

export interface MailboxCodeServiceRequest {
  mailbox: string
  providerId: MailProviderId
  challengeId: string
  /** Earliest acceptable provider message timestamp for this challenge. */
  notBefore?: number
  /** Message keys already consumed by the durable recovery session/round. */
  consumedMessageKeys: readonly string[]
  /** Message keys present before Send code for this round; never candidates for the new challenge. */
  baselineMessageKeys?: readonly string[]
  timeoutMs?: number
  pollIntervalMs?: number
}

export interface MailboxCodeServiceResult extends MailProviderCodeResult {
  challengeId: string
  consumedMessageKeys: readonly string[]
}

export interface MailboxCodeChallengeBaselineRequest {
  mailbox: string
  providerId: MailProviderId
}

export interface MailboxCodeChallengeBaselineResult {
  providerId: MailProviderId
  mailbox: string
  status: MailProviderResultStatus
  messageKeys: readonly string[]
  message: string
}

export interface MailboxCodeProviderSession {
  providerId: MailProviderId
  page: Page
  provider: MailProvider
}

export interface MailboxCodeServiceDependencies {
  resolveProviderSession: (providerId: MailProviderId) => Promise<MailboxCodeProviderSession | null>
  now?: () => number
}

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(MAX_TIMEOUT_MS, Math.floor(value)))
}

function normalizeMessageKeys(values: readonly string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.trim()).filter(Boolean))
}

function unionMessageKeys(...sets: readonly Set<string>[]): Set<string> {
  const result = new Set<string>()
  for (const set of sets) {
    for (const key of set) result.add(key)
  }
  return result
}

function withServiceMetadata(
  request: MailboxCodeServiceRequest,
  result: MailProviderCodeResult,
  consumed: Set<string>
): MailboxCodeServiceResult {
  return {
    ...result,
    challengeId: request.challengeId,
    consumedMessageKeys: [...consumed]
  }
}

function failureResult(
  request: MailboxCodeServiceRequest,
  mailbox: string,
  status: MailProviderCodeResult['status'],
  message: string,
  consumed: Set<string>
): MailboxCodeServiceResult {
  return {
    providerId: request.providerId,
    mailbox,
    status,
    code: null,
    sender: null,
    messageKey: null,
    message,
    challengeId: request.challengeId,
    consumedMessageKeys: [...consumed]
  }
}

function baselineFailure(
  request: MailboxCodeChallengeBaselineRequest,
  mailbox: string,
  status: MailProviderResultStatus,
  message: string
): MailboxCodeChallengeBaselineResult {
  return {
    providerId: request.providerId,
    mailbox,
    status,
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
    // The next resolve decides whether this page is still adoptable or whether
    // a fresh provider page is required. Recovery remains bounded by the caller.
  }
}

/**
 * Auth V2 mailbox-code boundary.
 *
 * It owns provider page/provider instance reuse, cross-round consumed-message
 * identity, and pre-Send baseline filtering. It intentionally knows nothing
 * about Microsoft DOM, Microsoft Next, authentication success, or round cleanup.
 */
export class MailboxCodeService {
  private readonly now: () => number
  private readonly sessions = new Map<MailProviderId, MailboxCodeProviderSession>()
  private readonly sessionConsumedMessageKeys = new Map<string, Set<string>>()

  constructor(private readonly dependencies: MailboxCodeServiceDependencies) {
    this.now = dependencies.now ?? Date.now
  }

  /** Snapshot message identity before Microsoft Send code without opening message detail. */
  async prepareChallengeBaseline(request: MailboxCodeChallengeBaselineRequest): Promise<MailboxCodeChallengeBaselineResult> {
    const mailbox = normalizeMailboxAddress(request.mailbox) ?? request.mailbox.trim().toLowerCase()
    const resolvedProviderId = resolveMailProviderId(mailbox)
    if (!mailbox || resolvedProviderId !== request.providerId) {
      return baselineFailure(request, mailbox, 'unsupported_mailbox', 'Mailbox/provider không khớp canonical provider đã resolve.')
    }
    if (request.providerId !== 'inboxes') {
      return baselineFailure(request, mailbox, 'unsupported_mailbox', `Baseline challenge chưa migrate provider ${request.providerId}.`)
    }

    const session = await this.resolveSession(request.providerId)
    if (!session) {
      return baselineFailure(request, mailbox, 'provider_unavailable', 'Không resolve/adopt được provider page cho Inboxes trước Send code.')
    }

    const vignetteState = await dismissInboxesGoogleVignette(session.page)
    if (vignetteState === 'blocked') {
      return baselineFailure(request, mailbox, 'provider_unavailable', 'Google vignette trên Inboxes đang chặn baseline trước Send code.')
    }

    const snapshot = session.provider.snapshotMessageKeys
    if (!snapshot) {
      return baselineFailure(request, mailbox, 'provider_unavailable', 'Provider Inboxes hiện tại không hỗ trợ baseline message identity.')
    }

    const pagesBeforeSnapshot = snapshotInboxesContextPages(session.page)
    let result: Awaited<ReturnType<NonNullable<MailProvider['snapshotMessageKeys']>>>
    try {
      result = await snapshot.call(session.provider, {
        mailbox,
        role: 'recovery',
        purpose: 'microsoft_security'
      })
    } catch {
      return baselineFailure(request, mailbox, 'provider_unavailable', 'Không snapshot được message identity từ Inboxes trước Send code.')
    }

    const unexpectedPopupCount = await closeUnexpectedInboxesPopupPages(session.page, pagesBeforeSnapshot)
    if (unexpectedPopupCount > 0 || hasInboxesProviderEscaped(session.page) || session.page.isClosed()) {
      this.sessions.delete(request.providerId)
      return baselineFailure(request, mailbox, 'provider_unavailable', 'Inboxes đổi/đóng provider page trong lúc baseline trước Send code.')
    }

    if (result.providerId !== request.providerId || normalizeMailboxAddress(result.mailbox) !== mailbox) {
      return baselineFailure(request, mailbox, 'provider_unavailable', 'Provider trả baseline không khớp mailbox/provider canonical.')
    }

    return {
      providerId: request.providerId,
      mailbox,
      status: result.status,
      messageKeys: [...normalizeMessageKeys(result.messageKeys)],
      message: result.message
    }
  }

  async getFreshCode(request: MailboxCodeServiceRequest): Promise<MailboxCodeServiceResult> {
    const mailbox = normalizeMailboxAddress(request.mailbox) ?? request.mailbox.trim().toLowerCase()
    const suppliedConsumed = normalizeMessageKeys(request.consumedMessageKeys)
    const baseline = normalizeMessageKeys(request.baselineMessageKeys)
    const resolvedProviderId = resolveMailProviderId(mailbox)

    if (!mailbox || resolvedProviderId !== request.providerId) {
      return failureResult(
        request,
        mailbox,
        'unsupported_mailbox',
        'Mailbox/provider không khớp canonical provider đã resolve.',
        suppliedConsumed
      )
    }

    // Issue #347 Batch 3 intentionally migrates Inboxes first. Other browser
    // providers keep their current semantics until they have equivalent regressions.
    if (request.providerId !== 'inboxes') {
      return failureResult(
        request,
        mailbox,
        'unsupported_mailbox',
        `MailboxCodeService chưa migrate provider ${request.providerId}.`,
        suppliedConsumed
      )
    }

    const consumed = this.sessionConsumedMessageKeys.get(mailbox) ?? new Set<string>()
    for (const key of suppliedConsumed) consumed.add(key)
    this.sessionConsumedMessageKeys.set(mailbox, consumed)

    const timeoutMs = boundedTimeout(request.timeoutMs)
    const startedAt = this.now()
    const deadline = startedAt + timeoutMs
    let consumedSkips = 0
    let closedPageRecoveries = 0
    let providerReloadRecoveries = 0

    while (true) {
      const session = await this.resolveSession(request.providerId)
      if (!session) {
        return failureResult(
          request,
          mailbox,
          'provider_unavailable',
          'Không resolve/adopt được provider page cho Inboxes.',
          consumed
        )
      }

      const vignetteState = await dismissInboxesGoogleVignette(session.page)
      if (vignetteState === 'blocked') {
        const recoveryRemainingMs = deadline - this.now()
        if (
          timeoutMs === 0
          || recoveryRemainingMs <= 0
          || providerReloadRecoveries >= MAX_PROVIDER_RELOAD_RECOVERIES
        ) {
          return failureResult(
            request,
            mailbox,
            'provider_unavailable',
            'Google vignette trên Inboxes đang chặn thao tác và không đóng được bằng Close đã audit.',
            consumed
          )
        }

        providerReloadRecoveries += 1
        this.sessions.delete(request.providerId)
        await recoverInboxesProviderPage(session.page, recoveryRemainingMs)
        if (this.now() >= deadline) {
          return failureResult(
            request,
            mailbox,
            'provider_unavailable',
            'Google vignette trên Inboxes vẫn chặn sau recovery có giới hạn.',
            consumed
          )
        }
        continue
      }

      const remainingMs = Math.max(0, deadline - this.now())
      const pagesBeforeProviderRead = snapshotInboxesContextPages(session.page)
      const excludedMessageKeys = [...unionMessageKeys(consumed, baseline)]
      const providerResult = await session.provider.getVerificationCode({
        mailbox,
        role: 'recovery',
        purpose: 'microsoft_security',
        ...(request.notBefore === undefined ? {} : { notBefore: request.notBefore }),
        excludedMessageKeys,
        timeoutMs: timeoutMs === 0 ? 0 : remainingMs,
        ...(request.pollIntervalMs === undefined ? {} : { pollIntervalMs: request.pollIntervalMs })
      })

      const unexpectedPopupCount = await closeUnexpectedInboxesPopupPages(session.page, pagesBeforeProviderRead)
      const providerEscaped = hasInboxesProviderEscaped(session.page)
      if (unexpectedPopupCount > 0 || providerEscaped) {
        const recoveryRemainingMs = deadline - this.now()
        this.sessions.delete(request.providerId)

        if (
          timeoutMs === 0
          || recoveryRemainingMs <= 0
          || providerReloadRecoveries >= MAX_PROVIDER_RELOAD_RECOVERIES
        ) {
          return failureResult(
            request,
            mailbox,
            'provider_unavailable',
            providerEscaped
              ? 'Tab Inboxes bị điều hướng sang trang ngoài provider trong lúc đọc mail.'
              : 'Click Inboxes bị quảng cáo chặn và mở tab ngoài provider.',
            consumed
          )
        }

        providerReloadRecoveries += 1
        await recoverInboxesProviderPage(session.page, recoveryRemainingMs)
        if (this.now() >= deadline) {
          return failureResult(
            request,
            mailbox,
            'provider_unavailable',
            'Inboxes không phục hồi kịp trong timeout sau khi quảng cáo chặn click.',
            consumed
          )
        }
        continue
      }

      if (
        providerResult.providerId !== request.providerId
        || normalizeMailboxAddress(providerResult.mailbox) !== mailbox
      ) {
        return failureResult(
          request,
          mailbox,
          'provider_unavailable',
          'Provider trả kết quả không khớp mailbox/provider canonical của challenge.',
          consumed
        )
      }

      // A browser page can disappear between listMessages() and readMessage().
      // BrowserMailboxProvider may then surface message_not_found instead of
      // provider_unavailable, so page ownership is the authoritative signal for
      // the one bounded re-adopt/recreate attempt.
      if (providerResult.status !== 'success' && session.page.isClosed()) {
        this.sessions.delete(request.providerId)
        if (closedPageRecoveries < MAX_CLOSED_PAGE_RECOVERIES) {
          const recoveryRemainingMs = deadline - this.now()
          if (timeoutMs > 0 && recoveryRemainingMs <= 0) {
            return withServiceMetadata(request, providerResult, consumed)
          }
          closedPageRecoveries += 1
          continue
        }
        return failureResult(
          request,
          mailbox,
          'provider_unavailable',
          'Provider page Inboxes đã đóng trong lúc đọc mail và không phục hồi được.',
          consumed
        )
      }

      // Live Inboxes can leave a promo/vignette surface in a state where the
      // audited Close control no longer responds. The operator-confirmed safe
      // recovery is one F5-equivalent reload. Recreate the provider adapter after
      // reload so ensureMailbox() re-detects Home/Add Inbox and rebinds the exact
      // canonical local-part + domain instead of keeping stale driver state.
      // Recovery is part of the caller's original budget: never add a fresh 10 s
      // tail after a 4 s rejected-code or 12 s normal request has already expired.
      if (providerResult.status === 'provider_unavailable' && providerReloadRecoveries < MAX_PROVIDER_RELOAD_RECOVERIES) {
        const recoveryRemainingMs = deadline - this.now()
        if (timeoutMs === 0 || recoveryRemainingMs <= 0) {
          return withServiceMetadata(request, providerResult, consumed)
        }

        providerReloadRecoveries += 1
        this.sessions.delete(request.providerId)
        await recoverInboxesProviderPage(session.page, recoveryRemainingMs)

        if (this.now() >= deadline) {
          return withServiceMetadata(request, providerResult, consumed)
        }
        continue
      }

      if (providerResult.status !== 'success') {
        return withServiceMetadata(request, providerResult, consumed)
      }

      const messageKey = providerResult.messageKey?.trim() ?? ''
      if (!messageKey || !providerResult.code) {
        return failureResult(
          request,
          mailbox,
          'provider_unavailable',
          'Provider trả success nhưng thiếu messageKey/code bắt buộc.',
          consumed
        )
      }

      if (!consumed.has(messageKey) && !baseline.has(messageKey)) {
        consumed.add(messageKey)
        return withServiceMetadata(request, providerResult, consumed)
      }

      // A provider adapter that does not understand excludedMessageKeys can still
      // return an old key. Keep the service boundary authoritative and retry the
      // same request; recreated adapters receive the same durable exclusion set.
      consumedSkips += 1
      if (consumedSkips >= MAX_CONSUMED_SKIPS || (timeoutMs > 0 && this.now() >= deadline)) {
        return failureResult(
          request,
          mailbox,
          timeoutMs === 0 ? 'message_not_found' : 'timeout',
          'Không có verification message mới sau khi loại baseline/consumed messageKey.',
          consumed
        )
      }
    }
  }

  /** Drop only the cached handle. Provider tabs and cross-round consumed identity stay intact. */
  invalidateProvider(providerId: MailProviderId): void {
    this.sessions.delete(providerId)
  }

  private async resolveSession(providerId: MailProviderId): Promise<MailboxCodeProviderSession | null> {
    const existing = this.sessions.get(providerId)
    if (existing && this.isSessionReusable(existing)) return existing
    if (existing) this.sessions.delete(providerId)

    let resolved: MailboxCodeProviderSession | null
    try {
      resolved = await this.dependencies.resolveProviderSession(providerId)
    } catch {
      // A closed/crashed Playwright context can reject context.newPage(). Keep
      // this boundary structured so Auth V2 can handle provider unavailability.
      return null
    }
    if (!resolved || resolved.page.isClosed() || resolved.provider.id !== providerId) return null
    this.sessions.set(providerId, resolved)
    return resolved
  }

  private isSessionReusable(session: MailboxCodeProviderSession): boolean {
    if (session.page.isClosed()) return false
    if (session.providerId !== 'inboxes') return true
    const url = session.page.url()
    return url === 'about:blank' || isInboxesProviderPageUrl(url)
  }
}

export function newestOpenInboxesProviderPage(pages: readonly Page[]): Page | null {
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const page = pages[index]
    if (page && !page.isClosed() && isInboxesProviderPageUrl(page.url())) return page
  }
  return null
}

export interface CreateMailboxCodeServiceOptions {
  now?: () => number
}

/**
 * Production owner: adopt an existing Inboxes tab when possible; only create a
 * provider page when none exists. Never closes pages and never calls
 * bringToFront(), so mailbox work does not explicitly steal Microsoft focus.
 */
export function createMailboxCodeService(
  context: BrowserContext,
  options: CreateMailboxCodeServiceOptions = {}
): MailboxCodeService {
  const registry = new EmailPageRegistry(context)

  return new MailboxCodeService({
    ...(options.now ? { now: options.now } : {}),
    resolveProviderSession: async (providerId) => {
      if (providerId !== 'inboxes') return null

      try {
        const existing = newestOpenInboxesProviderPage(registry.pages('mailbox_provider'))
        const page = existing ?? await context.newPage()
        if (page.isClosed()) return null

        return {
          providerId,
          page,
          provider: new InboxesProvider(new InboxesVisibleCodeFallbackDriver(
            page,
            new InboxesBackgroundPlaywrightDriver(page)
          ))
        }
      } catch {
        return null
      }
    }
  })
}
