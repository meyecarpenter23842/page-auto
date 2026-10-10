import type { Page } from 'playwright-core'
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

/**
 * Provider-neutral mailbox-code coordinator.
 *
 * Concrete provider composition/page recovery is injected by the composition root.
 * This service owns only provider-neutral session reuse, durable message identity,
 * pre-challenge baselining and bounded closed-page re-resolution. It knows nothing
 * about provider DOM/URLs or Microsoft UI/state transitions.
 */
export class MailboxCodeService {
  private readonly now: () => number
  private readonly sessions = new Map<MailProviderId, MailboxCodeProviderSession>()
  private readonly ownedProviderPages = new Map<MailProviderId, Page>()
  private readonly sessionConsumedMessageKeys = new Map<string, Set<string>>()

  constructor(private readonly dependencies: MailboxCodeServiceDependencies) {
    this.now = dependencies.now ?? Date.now
  }

  /** Snapshot message identity before a challenge without opening message detail. */
  async prepareChallengeBaseline(request: MailboxCodeChallengeBaselineRequest): Promise<MailboxCodeChallengeBaselineResult> {
    const mailbox = normalizeMailboxAddress(request.mailbox) ?? request.mailbox.trim().toLowerCase()
    const resolvedProviderId = resolveMailProviderId(mailbox)
    if (!mailbox || resolvedProviderId !== request.providerId) {
      return baselineFailure(request, mailbox, 'unsupported_mailbox', 'Mailbox/provider không khớp canonical provider đã resolve.')
    }

    const session = await this.resolveSession(request.providerId)
    if (!session) {
      return baselineFailure(
        request,
        mailbox,
        'provider_unavailable',
        `Không resolve/adopt được provider page cho ${request.providerId} trước challenge.`
      )
    }

    const snapshot = session.provider.snapshotMessageKeys
    if (!snapshot) {
      return baselineFailure(
        request,
        mailbox,
        'provider_unavailable',
        `Provider ${request.providerId} hiện tại không hỗ trợ baseline message identity.`
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
        `Không snapshot được message identity từ ${request.providerId} trước challenge.`
      )
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
          `Không resolve/adopt được provider page cho ${request.providerId}.`,
          consumed
        )
      }

      const remainingMs = Math.max(0, deadline - this.now())
      const excludedMessageKeys = [...unionMessageKeys(consumed, baseline)]
      let providerResult: MailProviderCodeResult
      try {
        providerResult = await session.provider.getVerificationCode({
          mailbox,
          role: 'recovery',
          purpose: 'microsoft_security',
          ...(request.notBefore === undefined ? {} : { notBefore: request.notBefore }),
          excludedMessageKeys,
          timeoutMs: timeoutMs === 0 ? 0 : remainingMs,
          ...(request.pollIntervalMs === undefined ? {} : { pollIntervalMs: request.pollIntervalMs })
        })
      } catch {
        return failureResult(
          request,
          mailbox,
          'provider_unavailable',
          `Provider ${request.providerId} lỗi trong lúc đọc verification message.`,
          consumed
        )
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

      // The composition root/provider module owns how a replacement page is found.
      // This boundary only notices that the injected session disappeared and makes
      // one bounded request for a fresh provider-neutral session.
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
          `Provider page ${request.providerId} đã đóng trong lúc đọc mail và không phục hồi được.`,
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

      // Keep the generic boundary authoritative even if an adapter ignores the
      // exclusion list. A re-resolved adapter receives the same durable keys.
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
    if (session.page.isClosed()) return false
    const url = session.page.url()
    if (url === 'about:blank') return true
    if (session.isReusablePageUrl) return session.isReusablePageUrl(url)
    return true
  }
}
