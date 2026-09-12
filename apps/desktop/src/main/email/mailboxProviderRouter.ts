import type { MailProvider, MailProviderId, MailboxCodeRequest } from './mailProvider'
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
}
