import type { MailMessageSnapshot } from './verificationCodeParser'
import { parseVerificationCode } from './verificationCodeParser'
import {
  normalizeMailboxAddress,
  type MailProvider,
  type MailProviderCodeRequest,
  type MailProviderCodeResult
} from './mailProvider'
import { resolveMailProviderId } from './mailProviderRegistry'

const DEFAULT_TIMEOUT_MS = 20_000
const MAX_TIMEOUT_MS = 60_000
const DEFAULT_POLL_MS = 1_500
const MIN_POLL_MS = 250
const MAX_POLL_MS = 5_000
const DEFAULT_FRESHNESS_GRACE_MS = 5_000

export interface InboxesMessageSummary {
  key: string
  sender: string
  subject: string
  preview: string
  receivedLabel: string
  receivedAt: number | null
}

export type InboxesEnsureMailboxResult =
  | { status: 'ready'; activeMailbox: string }
  | { status: 'mailbox_not_found' | 'provider_unavailable'; message: string }

export interface InboxesMailboxDriver {
  ensureMailbox(mailbox: string): Promise<InboxesEnsureMailboxResult>
  listMessages(now?: number): Promise<InboxesMessageSummary[]>
  readMessage(message: InboxesMessageSummary): Promise<MailMessageSnapshot | null>
  refreshMailbox(): Promise<void>
}

export interface InboxesProviderOptions {
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

function clampTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(MAX_TIMEOUT_MS, Math.floor(value)))
}

function clampPoll(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_POLL_MS
  return Math.max(MIN_POLL_MS, Math.min(MAX_POLL_MS, Math.floor(value)))
}

function messageLooksRelevant(request: MailProviderCodeRequest, message: InboxesMessageSummary): boolean {
  if (request.purpose === 'generic_verification') return true
  const text = `${message.sender}\n${message.subject}\n${message.preview}`
  return /microsoft|accountprotection|security|verification|xác minh|bảo mật/i.test(text)
}

function result(
  mailbox: string,
  status: MailProviderCodeResult['status'],
  message: string,
  detail?: { code: string; sender: string; messageKey: string }
): MailProviderCodeResult {
  return {
    providerId: 'inboxes',
    mailbox,
    status,
    code: detail?.code ?? null,
    sender: detail?.sender ?? null,
    messageKey: detail?.messageKey ?? null,
    message
  }
}

function validNotBefore(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * One provider for every domain served by Inboxes.com.
 *
 * The provider is deliberately role-agnostic: PRIMARY and RECOVERY callers use
 * the same mailbox implementation. It remembers messages already consumed and
 * also requires a fresh received timestamp, so a restarted runtime cannot reuse
 * an old verification email just because the consumed-key set is empty.
 */
export class InboxesProvider implements MailProvider {
  readonly id = 'inboxes' as const
  private readonly now: () => number
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly consumedMessageKeys = new Map<string, Set<string>>()

  constructor(
    private readonly driver: InboxesMailboxDriver,
    options: InboxesProviderOptions = {}
  ) {
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  }

  async getVerificationCode(request: MailProviderCodeRequest): Promise<MailProviderCodeResult> {
    const mailbox = normalizeMailboxAddress(request.mailbox)
    if (!mailbox || resolveMailProviderId(mailbox) !== 'inboxes') {
      return result(request.mailbox.trim().toLowerCase(), 'unsupported_mailbox', 'Mailbox không thuộc provider Inboxes đã biết.')
    }

    let prepared: InboxesEnsureMailboxResult
    try {
      prepared = await this.driver.ensureMailbox(mailbox)
    } catch {
      return result(mailbox, 'provider_unavailable', 'Không mở được Inboxes.com bằng Email runtime hiện tại.')
    }

    if (prepared.status !== 'ready') return result(mailbox, prepared.status, prepared.message)
    const activeMailbox = normalizeMailboxAddress(prepared.activeMailbox)
    if (activeMailbox !== mailbox) {
      return result(mailbox, 'mailbox_not_found', 'Inboxes đang mở mailbox khác với mailbox được yêu cầu.')
    }

    const requestStartedAt = this.now()
    const explicitNotBefore = validNotBefore(request.notBefore)
    const freshnessCutoff = explicitNotBefore ?? Math.max(1, requestStartedAt - DEFAULT_FRESHNESS_GRACE_MS)
    const timeoutMs = clampTimeout(request.timeoutMs)
    const pollMs = clampPoll(request.pollIntervalMs)
    const deadline = requestStartedAt + timeoutMs
    const consumed = this.consumedMessageKeys.get(mailbox) ?? new Set<string>()
    this.consumedMessageKeys.set(mailbox, consumed)

    while (true) {
      const now = this.now()
      let summaries: InboxesMessageSummary[]
      try {
        summaries = await this.driver.listMessages(now)
      } catch {
        return result(mailbox, 'provider_unavailable', 'Không đọc được danh sách mail từ Inboxes.com.')
      }

      const candidates = summaries.filter((message) => {
        if (consumed.has(message.key) || !messageLooksRelevant(request, message)) return false
        if (message.receivedAt === null || !Number.isFinite(message.receivedAt)) return false
        return message.receivedAt >= freshnessCutoff && message.receivedAt <= now + 5_000
      })

      for (const candidate of candidates) {
        let snapshot: MailMessageSnapshot | null
        try {
          snapshot = await this.driver.readMessage(candidate)
        } catch {
          return result(mailbox, 'provider_unavailable', 'Không mở được nội dung mail trên Inboxes.com.')
        }
        if (!snapshot) continue
        if (snapshot.receivedAt < freshnessCutoff || snapshot.receivedAt > this.now() + 5_000) continue
        const match = parseVerificationCode([snapshot], this.now())
        if (!match) continue

        consumed.add(candidate.key)
        return result(
          mailbox,
          'success',
          'Đã lấy verification code mới từ Inboxes.com.',
          { code: match.code, sender: match.sender, messageKey: candidate.key }
        )
      }

      if (this.now() >= deadline) {
        return result(
          mailbox,
          timeoutMs === 0 ? 'message_not_found' : 'timeout',
          timeoutMs === 0
            ? 'Chưa có mail verification mới phù hợp trong mailbox Inboxes hiện tại.'
            : 'Hết thời gian chờ mail verification mới từ Inboxes.com.'
        )
      }

      try {
        await this.driver.refreshMailbox()
      } catch {
        return result(mailbox, 'provider_unavailable', 'Không refresh được mailbox Inboxes.com.')
      }
      await this.sleep(Math.min(pollMs, Math.max(1, deadline - this.now())))
    }
  }
}
