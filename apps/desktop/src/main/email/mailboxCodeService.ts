import type { BrowserContext, Page } from 'playwright-core'
import { EmailPageRegistry } from './emailPageRegistry'
import { FviaInboxesPlaywrightDriver } from './fviaInboxesPlaywrightDriver'
import { FviaInboxesProvider } from './fviaInboxesProvider'
import { createInboxesMailboxRuntime } from './inboxesMailboxRuntime'
import {
  normalizeMailboxAddress,
  type MailProvider,
  type MailProviderCodeResult,
  type MailProviderId,
  type MailProviderResultStatus
} from './mailProvider'
import { resolveMailProviderId } from './mailProviderRegistry'
import { resolveMailboxProviderContext } from './mailboxProviderBrowserRuntime'

const DEFAULT_TIMEOUT_MS = 20_000
const MAX_TIMEOUT_MS = 60_000
const MAX_CONSUMED_SKIPS = 100
const MAX_CLOSED_PAGE_RECOVERIES = 1
const MAILBOX_CODE_SERVICE_PROVIDER_IDS = new Set<MailProviderId>(['inboxes', 'fvia_inboxes'])

export type MailboxCodeServiceProviderId = 'inboxes' | 'fvia_inboxes'

export function isMailboxCodeServiceProviderId(providerId: MailProviderId): providerId is MailboxCodeServiceProviderId {
  return MAILBOX_CODE_SERVICE_PROVIDER_IDS.has(providerId)
}

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
  isReusablePageUrl?: (value: string) => boolean
}

export interface MailboxCodeServiceDependencies {
  resolveProviderSession: (
    providerId: MailProviderId,
    preferredPage?: Page | null
  ) => Promise<MailboxCodeProviderSession | null>
  now?: () => number
  /** Direct callers stay Inboxes-only unless they explicitly opt into another audited service provider. */
  enabledProviderIds?: readonly MailboxCodeServiceProviderId[]
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

function providerLabel(providerId: MailProviderId): string {
  if (providerId === 'inboxes') return 'Inboxes'
  if (providerId === 'fvia_inboxes') return 'FviaInboxes'
  return providerId
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

export function isFviaInboxesProviderPageUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'fviainboxes.com' || hostname.endsWith('.fviainboxes.com')
  } catch {
    return false
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
  private readonly enabledProviderIds: ReadonlySet<MailboxCodeServiceProviderId>
  private readonly sessions = new Map<MailProviderId, MailboxCodeProviderSession>()
  private readonly ownedProviderPages = new Map<MailProviderId, Page>()
  private readonly sessionConsumedMessageKeys = new Map<string, Set<string>>()

  constructor(private readonly dependencies: MailboxCodeServiceDependencies) {
    this.now = dependencies.now ?? Date.now
    this.enabledProviderIds = new Set(dependencies.enabledProviderIds ?? ['inboxes'])
  }

  private providerEnabled(providerId: MailProviderId): providerId is MailboxCodeServiceProviderId {
    return isMailboxCodeServiceProviderId(providerId) && this.enabledProviderIds.has(providerId)
  }

  /** Snapshot message identity before Microsoft Send code without opening message detail. */
  async prepareChallengeBaseline(request: MailboxCodeChallengeBaselineRequest): Promise<MailboxCodeChallengeBaselineResult> {
    const mailbox = normalizeMailboxAddress(request.mailbox) ?? request.mailbox.trim().toLowerCase()
    const resolvedProviderId = resolveMailProviderId(mailbox)
    if (!mailbox || resolvedProviderId !== request.providerId) {
      return baselineFailure(request, mailbox, 'unsupported_mailbox', 'Mailbox/provider không khớp canonical provider đã resolve.')
    }
    if (!this.providerEnabled(request.providerId)) {
      return baselineFailure(request, mailbox, 'unsupported_mailbox', `Baseline challenge chưa migrate provider ${request.providerId}.`)
    }

    const session = await this.resolveSession(request.providerId)
    if (!session) {
      return baselineFailure(
        request,
        mailbox,
        'provider_unavailable',
        `Không resolve/adopt được provider page cho ${providerLabel(request.providerId)} trước Send code.`
      )
    }

    const snapshot = session.provider.snapshotMessageKeys
    if (!snapshot) {
      return baselineFailure(
        request,
        mailbox,
        'provider_unavailable',
        `Provider ${providerLabel(request.providerId)} hiện tại không hỗ trợ baseline message identity.`
      )
    }

    let result: Awaited<ReturnType<NonNullable<MailProvider['snapshotMessageKeys']>>>
    try {
      result = await snapshot.call(session.provider, {
        mailbox,
        role: 'recovery',
        purpose: 'microsoft_security'
      })
    } catch {
      return baselineFailure(
        request,
        mailbox,
        'provider_unavailable',
        `Không snapshot được message identity từ ${providerLabel(request.providerId)} trước Send code.`
      )
    }


    if (
      request.providerId === 'fvia_inboxes'
      && (session.page.isClosed() || !isFviaInboxesProviderPageUrl(session.page.url()))
    ) {
      this.sessions.delete(request.providerId)
      return baselineFailure(request, mailbox, 'provider_unavailable', 'FviaInboxes đổi/đóng provider page trong lúc baseline trước Send code.')
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

    if (!this.providerEnabled(request.providerId)) {
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

    while (true) {
      const session = await this.resolveSession(request.providerId)
      if (!session) {
        return failureResult(
          request,
          mailbox,
          'provider_unavailable',
          `Không resolve/adopt được provider page cho ${providerLabel(request.providerId)}.`,
          consumed
        )
      }


      const remainingMs = Math.max(0, deadline - this.now())
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
          `Provider page ${providerLabel(request.providerId)} đã đóng trong lúc đọc mail và không phục hồi được.`,
          consumed
        )
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

  /** Drop only the cached adapter handle. Owned provider page and consumed identity stay intact. */
  invalidateProvider(providerId: MailProviderId): void {
    this.sessions.delete(providerId)
  }

  private async resolveSession(providerId: MailProviderId): Promise<MailboxCodeProviderSession | null> {
    const existing = this.sessions.get(providerId)
    if (existing && this.isSessionReusable(existing)) return existing

    const ownedPage = existing?.page ?? this.ownedProviderPages.get(providerId) ?? null
    if (existing) this.sessions.delete(providerId)
    if (ownedPage?.isClosed()) this.ownedProviderPages.delete(providerId)
    const preferredPage = ownedPage && !ownedPage.isClosed() ? ownedPage : null

    let resolved: MailboxCodeProviderSession | null
    try {
      resolved = await this.dependencies.resolveProviderSession(providerId, preferredPage)
    } catch {
      // A closed/crashed Playwright context can reject context.newPage(). Keep
      // this boundary structured so Auth V2 can handle provider unavailability.
      return null
    }
    if (
      !resolved
      || resolved.page.isClosed()
      || resolved.providerId !== providerId
      || resolved.provider.id !== providerId
    ) return null
    this.sessions.set(providerId, resolved)
    this.ownedProviderPages.set(providerId, resolved.page)
    return resolved
  }

  private isSessionReusable(session: MailboxCodeProviderSession): boolean {
    if (session.page.isClosed() || !isMailboxCodeServiceProviderId(session.providerId)) return false
    const url = session.page.url()
    if (url === 'about:blank') return true
    if (session.isReusablePageUrl) return session.isReusablePageUrl(url)
    if (session.providerId === 'fvia_inboxes') return isFviaInboxesProviderPageUrl(url)
    // Direct/test sessions expose only the provider-neutral contract. Production
    // Inboxes sessions provide their own URL classifier from the Inboxes module.
    return true
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

export interface CreateMailboxCodeServiceOptions {
  now?: () => number
}

/**
 * Production owner: resolve the mailbox provider into the isolated provider
 * context configured by Microsoft Auth V2. Direct/unit callers without that
 * configuration keep legacy context semantics. Provider page ownership/reuse is
 * unchanged, but automatic recovery no longer adds a tab to visible Chrome.
 */
export function createMailboxCodeService(
  context: BrowserContext,
  options: CreateMailboxCodeServiceOptions = {}
): MailboxCodeService {
  return new MailboxCodeService({
    ...(options.now ? { now: options.now } : {}),
    enabledProviderIds: ['inboxes', 'fvia_inboxes'],
    resolveProviderSession: async (providerId, preferredPage) => {
      if (!isMailboxCodeServiceProviderId(providerId)) return null

      try {
        const providerContext = await resolveMailboxProviderContext(context)
        if (!providerContext) return null
        const registry = new EmailPageRegistry(providerContext)
        if (providerId === 'inboxes') {
          const runtime = await createInboxesMailboxRuntime({
            preferredPage,
            pages: registry.pages('mailbox_provider'),
            createPage: async () => await providerContext.newPage()
          })
          if (!runtime) return null
          return {
            providerId,
            page: runtime.page,
            provider: runtime.provider,
            isReusablePageUrl: runtime.isReusablePageUrl
          }
        }

        const page = ownedOrNewestOpenFviaInboxesProviderPage(
          preferredPage,
          registry.pages('mailbox_provider')
        ) ?? await providerContext.newPage()
        if (page.isClosed()) return null

        return {
          providerId,
          page,
          provider: new FviaInboxesProvider(new FviaInboxesPlaywrightDriver(page)),
          isReusablePageUrl: isFviaInboxesProviderPageUrl
        }
      } catch {
        return null
      }
    }
  })
}
