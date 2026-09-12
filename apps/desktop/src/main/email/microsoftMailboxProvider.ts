import type {
  MailProvider,
  MailProviderCodeRequest,
  MailProviderCodeResult,
  MailProviderMessageKeySnapshotRequest,
  MailProviderMessageKeySnapshotResult
} from './mailProvider'
import { normalizeMailboxAddress } from './mailProvider'
import { resolveMailProviderId } from './mailProviderRegistry'
import { parseVerificationCode, type MailMessageSnapshot } from './verificationCodeParser'

const DEFAULT_TIMEOUT_MS = 20_000
const MAX_TIMEOUT_MS = 60_000
const DEFAULT_POLL_INTERVAL_MS = 1_500
const MAX_MESSAGE_LIMIT = 50

export interface MicrosoftMailboxProviderDependencies {
  mailbox: string
  readMessages: (limit: number) => Promise<MailMessageSnapshot[]>
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(MAX_TIMEOUT_MS, Math.floor(value)))
}

function boundedPollInterval(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_POLL_INTERVAL_MS
  return Math.max(100, Math.min(10_000, Math.floor(value)))
}

function codeFailure(
  mailbox: string,
  status: MailProviderCodeResult['status'],
  message: string
): MailProviderCodeResult {
  return {
    providerId: 'microsoft',
    mailbox,
    status,
    code: null,
    sender: null,
    messageKey: null,
    message
  }
}

function snapshotFailure(
  mailbox: string,
  status: MailProviderMessageKeySnapshotResult['status'],
  message: string
): MailProviderMessageKeySnapshotResult {
  return {
    providerId: 'microsoft',
    mailbox,
    status,
    messageKeys: [],
    message
  }
}

/**
 * Hotmail/Outlook mailbox provider backed by the canonical Microsoft mailbox
 * transport supplied by Main. This module owns message freshness/identity and
 * code parsing; it knows nothing about Microsoft Auth surfaces.
 */
export class MicrosoftMailboxProvider implements MailProvider {
  readonly id = 'microsoft' as const
  readonly resumeFreshness = 'lookback' as const
  private readonly mailbox: string
  private readonly now: () => number
  private readonly sleep: (milliseconds: number) => Promise<void>

  constructor(private readonly dependencies: MicrosoftMailboxProviderDependencies) {
    const mailbox = normalizeMailboxAddress(dependencies.mailbox)
    if (!mailbox || resolveMailProviderId(mailbox) !== 'microsoft') {
      throw new Error('MicrosoftMailboxProvider requires a canonical Hotmail/Outlook mailbox.')
    }
    this.mailbox = mailbox
    this.now = dependencies.now ?? Date.now
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  }

  async snapshotMessageKeys(
    request: MailProviderMessageKeySnapshotRequest
  ): Promise<MailProviderMessageKeySnapshotResult> {
    const mailbox = normalizeMailboxAddress(request.mailbox) ?? request.mailbox.trim().toLowerCase()
    if (mailbox !== this.mailbox) {
      return snapshotFailure(mailbox, 'unsupported_mailbox', 'Microsoft mailbox request không khớp mailbox canonical đã bind.')
    }

    try {
      const messages = await this.dependencies.readMessages(MAX_MESSAGE_LIMIT)
      return {
        providerId: 'microsoft',
        mailbox,
        status: 'success',
        messageKeys: [...new Set(messages.map((message) => message.id.trim()).filter(Boolean))],
        message: 'Đã snapshot Microsoft mailbox message identity.'
      }
    } catch {
      return snapshotFailure(mailbox, 'provider_unavailable', 'Không đọc được Microsoft mailbox để baseline message identity.')
    }
  }

  async getVerificationCode(request: MailProviderCodeRequest): Promise<MailProviderCodeResult> {
    const mailbox = normalizeMailboxAddress(request.mailbox) ?? request.mailbox.trim().toLowerCase()
    if (mailbox !== this.mailbox) {
      return codeFailure(mailbox, 'unsupported_mailbox', 'Microsoft mailbox request không khớp mailbox canonical đã bind.')
    }

    const excludedMessageKeys = new Set((request.excludedMessageKeys ?? []).map((value) => value.trim()).filter(Boolean))
    const timeoutMs = boundedTimeout(request.timeoutMs)
    const pollIntervalMs = boundedPollInterval(request.pollIntervalMs)
    const deadline = this.now() + timeoutMs

    while (true) {
      let messages: MailMessageSnapshot[]
      try {
        messages = await this.dependencies.readMessages(MAX_MESSAGE_LIMIT)
      } catch {
        return codeFailure(mailbox, 'provider_unavailable', 'Không đọc được Microsoft mailbox bằng OAuth/Graph canonical.')
      }

      const now = this.now()
      const eligible = messages.filter((message) => {
        if (!message.id.trim() || excludedMessageKeys.has(message.id.trim())) return false
        if (request.notBefore !== undefined && message.receivedAt < request.notBefore) return false
        return true
      })
      const match = parseVerificationCode(eligible, now)
      if (match?.messageId?.trim()) {
        return {
          providerId: 'microsoft',
          mailbox,
          status: 'success',
          code: match.code,
          sender: match.sender || null,
          messageKey: match.messageId,
          message: 'Đã lấy verification code mới từ Microsoft mailbox.'
        }
      }

      if (timeoutMs === 0) {
        return codeFailure(mailbox, 'message_not_found', 'Chưa tìm thấy verification code mới phù hợp trong Microsoft mailbox.')
      }
      if (this.now() >= deadline) {
        return codeFailure(mailbox, 'timeout', 'Hết thời gian chờ verification code mới từ Microsoft mailbox.')
      }
      await this.sleep(Math.min(pollIntervalMs, Math.max(1, deadline - this.now())))
    }
  }
}
