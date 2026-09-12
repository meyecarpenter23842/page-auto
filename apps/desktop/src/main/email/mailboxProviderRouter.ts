import type {
  MailProvider,
  MailProviderCodeResult,
  MailProviderId,
  MailProviderResultStatus,
  MailboxCodeRequest
} from './mailProvider'
import { normalizeMailboxAddress } from './mailProvider'
import { resolveMailProviderId } from './mailProviderRegistry'

export type MailboxProviderResolver = (
  request: MailboxCodeRequest
) => MailProvider | null | Promise<MailProvider | null>

export interface MailboxProviderRegistration {
  providerId: MailProviderId
  resolve: MailboxProviderResolver
}

export type MailboxProviderResolution =
  | {
      status: 'resolved'
      providerId: MailProviderId
      mailbox: string
      provider: MailProvider
      request: MailboxCodeRequest
    }
  | {
      status: 'unsupported_mailbox'
      providerId: null
      mailbox: string
      message: string
    }
  | {
      status: 'provider_unavailable'
      providerId: MailProviderId
      mailbox: string
      message: string
    }


export interface MailboxChallengeBaselineResult {
  providerId: MailProviderId | null
  mailbox: string
  status: MailProviderResultStatus
  challengeId: string
  messageKeys: readonly string[]
  message: string
}

export interface MailboxResumePreparationResult extends MailboxChallengeBaselineResult {
  notBefore: number
}

export interface MailboxRouterCodeResult {
  providerId: MailProviderId | null
  mailbox: string
  status: MailProviderResultStatus
  code: string | null
  sender: string | null
  messageKey: string | null
  message: string
  challengeId: string
}

/**
 * Provider-neutral composition root for mailbox modules.
 *
 * This class may know provider ids and registrations, but never provider DOM,
 * URLs, popup handling, Microsoft auth state, or provider-specific retry policy.
 */
export class MailboxProviderRouter {
  private readonly registrations = new Map<MailProviderId, MailboxProviderResolver>()

  constructor(registrations: readonly MailboxProviderRegistration[]) {
    for (const registration of registrations) {
      if (this.registrations.has(registration.providerId)) {
        throw new Error(`Duplicate mailbox provider registration: ${registration.providerId}`)
      }
      this.registrations.set(registration.providerId, registration.resolve)
    }
  }

  async resolve(request: MailboxCodeRequest): Promise<MailboxProviderResolution> {
    const mailbox = normalizeMailboxAddress(request.mailbox)
    if (!mailbox) {
      return {
        status: 'unsupported_mailbox',
        providerId: null,
        mailbox: request.mailbox.trim().toLowerCase(),
        message: 'Mailbox không hợp lệ hoặc không có domain để resolve provider.'
      }
    }

    const providerId = resolveMailProviderId(mailbox)
    if (!providerId) {
      return {
        status: 'unsupported_mailbox',
        providerId: null,
        mailbox,
        message: 'Mailbox domain chưa được đăng ký provider.'
      }
    }

    const resolver = this.registrations.get(providerId)
    if (!resolver) {
      return {
        status: 'provider_unavailable',
        providerId,
        mailbox,
        message: `Provider ${providerId} đã được nhận diện nhưng chưa được đăng ký implementation trong composition root hiện tại.`
      }
    }

    const normalizedRequest: MailboxCodeRequest = {
      ...request,
      mailbox
    }
    let provider: MailProvider | null
    try {
      provider = await resolver(normalizedRequest)
    } catch {
      return {
        status: 'provider_unavailable',
        providerId,
        mailbox,
        message: `Provider ${providerId} gặp lỗi khi resolve implementation cho mailbox hiện tại.`
      }
    }

    if (!provider || provider.id !== providerId) {
      return {
        status: 'provider_unavailable',
        providerId,
        mailbox,
        message: provider
          ? `Provider registration ${providerId} trả implementation sai id ${provider.id}.`
          : `Provider ${providerId} không resolve được implementation cho mailbox hiện tại.`
      }
    }

    return {
      status: 'resolved',
      providerId,
      mailbox,
      provider,
      request: normalizedRequest
    }
  }

  async prepareChallenge(request: MailboxCodeRequest): Promise<MailboxChallengeBaselineResult> {
    const resolution = await this.resolve(request)
    if (resolution.status !== 'resolved') {
      return this.baselineFailure(
        request,
        resolution.providerId,
        resolution.mailbox,
        resolution.status,
        resolution.message
      )
    }
    return await this.snapshotResolved(resolution)
  }

  async prepareResumeChallenge(
    request: MailboxCodeRequest,
    options: { lookbackMs: number; now?: number }
  ): Promise<MailboxResumePreparationResult> {
    const now = options.now ?? Date.now()
    const lookbackNotBefore = Math.max(1, now - Math.max(0, options.lookbackMs))
    const resolution = await this.resolve(request)
    if (resolution.status !== 'resolved') {
      return {
        ...this.baselineFailure(
          request,
          resolution.providerId,
          resolution.mailbox,
          resolution.status,
          resolution.message
        ),
        notBefore: lookbackNotBefore
      }
    }

    if (resolution.provider.resumeFreshness !== 'baseline_current') {
      return {
        providerId: resolution.providerId,
        mailbox: resolution.mailbox,
        status: 'success',
        challengeId: request.challengeId,
        messageKeys: [],
        message: 'Provider dùng timestamp/lookback freshness khi resume challenge.',
        notBefore: lookbackNotBefore
      }
    }

    const baseline = await this.snapshotResolved(resolution)
    return {
      ...baseline,
      notBefore: baseline.status === 'success' ? Math.max(1, now) : lookbackNotBefore
    }
  }

  async getFreshCode(request: MailboxCodeRequest): Promise<MailboxRouterCodeResult> {
    const resolution = await this.resolve(request)
    if (resolution.status !== 'resolved') {
      return this.codeFailure(
        request,
        resolution.providerId,
        resolution.mailbox,
        resolution.status,
        resolution.message
      )
    }

    const excludedMessageKeys = [...new Set([
      ...(request.baselineMessageKeys ?? []),
      ...(request.consumedMessageKeys ?? [])
    ].map((value) => value.trim()).filter(Boolean))]

    let result: MailProviderCodeResult
    try {
      result = await resolution.provider.getVerificationCode({
        mailbox: resolution.mailbox,
        role: request.role,
        purpose: request.purpose,
        ...(request.notBefore === undefined ? {} : { notBefore: request.notBefore }),
        excludedMessageKeys,
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
        ...(request.pollIntervalMs === undefined ? {} : { pollIntervalMs: request.pollIntervalMs })
      })
    } catch {
      return this.codeFailure(
        request,
        resolution.providerId,
        resolution.mailbox,
        'provider_unavailable',
        `Provider ${resolution.providerId} gặp lỗi khi đọc verification code.`
      )
    }

    if (
      result.providerId !== resolution.providerId
      || normalizeMailboxAddress(result.mailbox) !== resolution.mailbox
    ) {
      return this.codeFailure(
        request,
        resolution.providerId,
        resolution.mailbox,
        'provider_unavailable',
        'Provider trả code result không khớp mailbox/provider canonical của challenge.'
      )
    }

    if (result.status === 'success' && (!result.code || !result.messageKey?.trim())) {
      return this.codeFailure(
        request,
        resolution.providerId,
        resolution.mailbox,
        'provider_unavailable',
        'Provider trả success nhưng thiếu code/messageKey bắt buộc.'
      )
    }

    return {
      ...result,
      providerId: resolution.providerId,
      mailbox: resolution.mailbox,
      challengeId: request.challengeId
    }
  }

  private async snapshotResolved(
    resolution: Extract<MailboxProviderResolution, { status: 'resolved' }>
  ): Promise<MailboxChallengeBaselineResult> {
    const snapshot = resolution.provider.snapshotMessageKeys
    if (!snapshot) {
      return this.baselineFailure(
        resolution.request,
        resolution.providerId,
        resolution.mailbox,
        'provider_unavailable',
        `Provider ${resolution.providerId} không hỗ trợ baseline message identity.`
      )
    }

    let result: Awaited<ReturnType<NonNullable<MailProvider['snapshotMessageKeys']>>>
    try {
      result = await snapshot.call(resolution.provider, {
        mailbox: resolution.mailbox,
        role: resolution.request.role,
        purpose: resolution.request.purpose
      })
    } catch {
      return this.baselineFailure(
        resolution.request,
        resolution.providerId,
        resolution.mailbox,
        'provider_unavailable',
        `Provider ${resolution.providerId} gặp lỗi khi baseline message identity.`
      )
    }

    if (
      result.providerId !== resolution.providerId
      || normalizeMailboxAddress(result.mailbox) !== resolution.mailbox
    ) {
      return this.baselineFailure(
        resolution.request,
        resolution.providerId,
        resolution.mailbox,
        'provider_unavailable',
        'Provider trả baseline không khớp mailbox/provider canonical.'
      )
    }

    return {
      providerId: resolution.providerId,
      mailbox: resolution.mailbox,
      status: result.status,
      challengeId: resolution.request.challengeId,
      messageKeys: [...new Set(result.messageKeys.map((value) => value.trim()).filter(Boolean))],
      message: result.message
    }
  }

  private baselineFailure(
    request: MailboxCodeRequest,
    providerId: MailProviderId | null,
    mailbox: string,
    status: MailProviderResultStatus,
    message: string
  ): MailboxChallengeBaselineResult {
    return {
      providerId,
      mailbox,
      status,
      challengeId: request.challengeId,
      messageKeys: [],
      message
    }
  }

  private codeFailure(
    request: MailboxCodeRequest,
    providerId: MailProviderId | null,
    mailbox: string,
    status: MailProviderResultStatus,
    message: string
  ): MailboxRouterCodeResult {
    return {
      providerId,
      mailbox,
      status,
      code: null,
      sender: null,
      messageKey: null,
      message,
      challengeId: request.challengeId
    }
  }
}
