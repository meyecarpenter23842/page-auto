import type { MailMessageSnapshot } from './verificationCodeParser'
import { parseVerificationCode } from './verificationCodeParser'
import { emailDiagnostic } from './emailRuntimeDiagnostic'
import {
  normalizeMailboxAddress,
  type MailProvider,
  type MailProviderCodeRequest,
  type MailProviderCodeResult,
  type MailProviderId,
  type MailProviderMessageKeySnapshotRequest,
  type MailProviderMessageKeySnapshotResult
} from './mailProvider'

const DEFAULT_TIMEOUT_MS = 20_000
const MAX_TIMEOUT_MS = 60_000
const DEFAULT_POLL_MS = 1_500
const MIN_POLL_MS = 250
const MAX_POLL_MS = 5_000
const DEFAULT_FRESHNESS_GRACE_MS = 5_000

export interface BrowserMailboxMessageSummary {
  key: string
  sender: string
  subject: string
  preview: string
  receivedLabel: string
  receivedAt: number | null
}

export type MicrosoftMailboxMessageKind =
  | 'microsoft_security_code'
  | 'microsoft_unusual_signin_notification'
  | 'microsoft_other_notification'
  | 'unknown'

export type BrowserEnsureMailboxResult =
  | { status: 'ready'; activeMailbox: string }
  | { status: 'mailbox_not_found' | 'provider_unavailable'; message: string }

export interface BrowserMailboxDriver {
  ensureMailbox(mailbox: string): Promise<BrowserEnsureMailboxResult>
  listMessages(now?: number): Promise<BrowserMailboxMessageSummary[]>
  readMessage(message: BrowserMailboxMessageSummary): Promise<MailMessageSnapshot | null>
  refreshMailbox(): Promise<void>
}

export interface BrowserMailboxProviderOptions {
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

export interface BrowserMailboxProviderConfig<Id extends MailProviderId> extends BrowserMailboxProviderOptions {
  providerId: Id
  providerLabel: string
  supportsMailbox: (mailbox: string) => boolean
  /**
   * Some audited browser inboxes do not expose a trustworthy received timestamp.
   * When enabled, freshness is based on when a message key was first observed in
   * this provider instance. A pre-Send warm-up can therefore baseline existing
   * messages without inventing a historical timestamp.
   */
  useFirstSeenWhenTimestampMissing?: boolean
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

function normalizedSummaryText(message: BrowserMailboxMessageSummary): {
  sender: string
  subject: string
  preview: string
  combined: string
} {
  const sender = message.sender.replace(/\s+/g, ' ').trim().toLowerCase()
  const subject = message.subject.replace(/\s+/g, ' ').trim().toLowerCase()
  const preview = message.preview.replace(/\s+/g, ' ').trim().toLowerCase()
  return { sender, subject, preview, combined: `${sender}\n${subject}\n${preview}` }
}

/** Classify Microsoft mail from list-row evidence before any message detail is opened. */
export function classifyMicrosoftMailboxMessage(message: BrowserMailboxMessageSummary): MicrosoftMailboxMessageKind {
  const { sender, subject, preview, combined } = normalizedSummaryText(message)
  const microsoftEvidence = /microsoft|accountprotection(?:\.microsoft)?|account protection/.test(combined)
  if (!microsoftEvidence) return 'unknown'

  const unusualSignIn = /unusual\s+sign[ -]?in(?:\s+activity)?|suspicious\s+sign[ -]?in|unrecognized\s+sign[ -]?in/.test(`${subject}\n${preview}`)
  if (unusualSignIn) return 'microsoft_unusual_signin_notification'

  const codeEvidence = /\bsecurity\s+code\b|\bverification\s+code\b|\bone[ -]?time\s+code\b|\buse\s+(?:this\s+)?code\b|\bcode\s+to\s+verify\b|mã\s+(?:bảo\s+mật|xác\s+minh)/i.test(`${subject}\n${preview}`)
  const trustedSender = /microsoft|accountprotection/.test(sender)
  if (codeEvidence && trustedSender) return 'microsoft_security_code'

  return 'microsoft_other_notification'
}

function messageLooksRelevant(request: MailProviderCodeRequest, message: BrowserMailboxMessageSummary): boolean {
  if (request.purpose === 'generic_verification') return true
  return classifyMicrosoftMailboxMessage(message) === 'microsoft_security_code'
}

function validNotBefore(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function normalizeMessageKeys(values: readonly string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.trim()).filter(Boolean))
}

export class BrowserMailboxProvider<Id extends MailProviderId> implements MailProvider {
  readonly id: Id
  private readonly now: () => number
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly consumedMessageKeys = new Map<string, Set<string>>()
  private readonly firstSeenMessageAt = new Map<string, Map<string, number>>()

  constructor(
    private readonly driver: BrowserMailboxDriver,
    private readonly config: BrowserMailboxProviderConfig<Id>
  ) {
    this.id = config.providerId
    this.now = config.now ?? Date.now
    this.sleep = config.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  }

  async snapshotMessageKeys(request: MailProviderMessageKeySnapshotRequest): Promise<MailProviderMessageKeySnapshotResult> {
    const mailbox = normalizeMailboxAddress(request.mailbox)
    if (!mailbox || !this.config.supportsMailbox(mailbox)) {
      return this.snapshotResult(
        request.mailbox.trim().toLowerCase(),
        'unsupported_mailbox',
        `Mailbox không thuộc provider ${this.config.providerLabel} đã biết.`,
        []
      )
    }

    let prepared: BrowserEnsureMailboxResult
    try {
      prepared = await this.driver.ensureMailbox(mailbox)
    } catch {
      return this.snapshotResult(mailbox, 'provider_unavailable', `Không mở được ${this.config.providerLabel} bằng Email runtime hiện tại.`, [])
    }

    if (prepared.status !== 'ready') return this.snapshotResult(mailbox, prepared.status, prepared.message, [])
    if (normalizeMailboxAddress(prepared.activeMailbox) !== mailbox) {
      return this.snapshotResult(mailbox, 'mailbox_not_found', `${this.config.providerLabel} đang mở mailbox khác với mailbox được yêu cầu.`, [])
    }

    let summaries: BrowserMailboxMessageSummary[]
    try {
      summaries = await this.driver.listMessages(this.now())
    } catch {
      return this.snapshotResult(mailbox, 'provider_unavailable', `Không đọc được danh sách mail từ ${this.config.providerLabel}.`, [])
    }

    const messageKeys = [...new Set(summaries.map((message) => message.key.trim()).filter(Boolean))]
    emailDiagnostic('mailbox-provider', 'snapshot-keys', {
      provider: this.config.providerLabel,
      purpose: request.purpose,
      count: messageKeys.length
    })
    return this.snapshotResult(mailbox, 'success', `Đã baseline message identity từ ${this.config.providerLabel}.`, messageKeys)
  }

  async getVerificationCode(request: MailProviderCodeRequest): Promise<MailProviderCodeResult> {
    const mailbox = normalizeMailboxAddress(request.mailbox)
    if (!mailbox || !this.config.supportsMailbox(mailbox)) {
      emailDiagnostic('mailbox-provider', 'unsupported-mailbox', {
        provider: this.config.providerLabel
      })
      return this.result(
        request.mailbox.trim().toLowerCase(),
        'unsupported_mailbox',
        `Mailbox không thuộc provider ${this.config.providerLabel} đã biết.`
      )
    }

    let prepared: BrowserEnsureMailboxResult
    try {
      prepared = await this.driver.ensureMailbox(mailbox)
    } catch {
      emailDiagnostic('mailbox-provider', 'ensure-error', {
        provider: this.config.providerLabel
      })
      return this.result(mailbox, 'provider_unavailable', `Không mở được ${this.config.providerLabel} bằng Email runtime hiện tại.`)
    }

    emailDiagnostic('mailbox-provider', 'ensure-result', {
      provider: this.config.providerLabel,
      status: prepared.status,
      activeMatches: prepared.status === 'ready'
        ? normalizeMailboxAddress(prepared.activeMailbox) === mailbox
        : false
    })

    if (prepared.status !== 'ready') return this.result(mailbox, prepared.status, prepared.message)
    const activeMailbox = normalizeMailboxAddress(prepared.activeMailbox)
    if (activeMailbox !== mailbox) {
      return this.result(mailbox, 'mailbox_not_found', `${this.config.providerLabel} đang mở mailbox khác với mailbox được yêu cầu.`)
    }

    const requestStartedAt = this.now()
    const explicitNotBefore = validNotBefore(request.notBefore)
    const freshnessCutoff = explicitNotBefore ?? Math.max(1, requestStartedAt - DEFAULT_FRESHNESS_GRACE_MS)
    const timeoutMs = clampTimeout(request.timeoutMs)
    const pollMs = clampPoll(request.pollIntervalMs)
    const deadline = requestStartedAt + timeoutMs
    const consumed = this.consumedMessageKeys.get(mailbox) ?? new Set<string>()
    this.consumedMessageKeys.set(mailbox, consumed)
    const excluded = normalizeMessageKeys(request.excludedMessageKeys)
    const firstSeen = this.firstSeenMessageAt.get(mailbox) ?? new Map<string, number>()
    this.firstSeenMessageAt.set(mailbox, firstSeen)

    emailDiagnostic('mailbox-provider', 'request', {
      provider: this.config.providerLabel,
      purpose: request.purpose,
      explicitNotBefore: explicitNotBefore !== null,
      cutoffAgeMs: requestStartedAt - freshnessCutoff,
      timeoutMs,
      pollMs,
      consumedKeys: consumed.size,
      excludedKeys: excluded.size
    })

    let poll = 0
    while (true) {
      poll += 1
      const now = this.now()
      let summaries: BrowserMailboxMessageSummary[]
      try {
        summaries = await this.driver.listMessages(now)
      } catch {
        emailDiagnostic('mailbox-provider', 'list-error', {
          provider: this.config.providerLabel,
          poll
        })
        return this.result(mailbox, 'provider_unavailable', `Không đọc được danh sách mail từ ${this.config.providerLabel}.`)
      }

      emailDiagnostic('mailbox-provider', 'poll', {
        provider: this.config.providerLabel,
        poll,
        summaries: summaries.length
      })

      const candidates = summaries.flatMap((message, index) => {
        const providerConsumed = consumed.has(message.key)
        const requestExcluded = excluded.has(message.key)
        const alreadyConsumed = providerConsumed || requestExcluded
        const messageKind = request.purpose === 'microsoft_security'
          ? classifyMicrosoftMailboxMessage(message)
          : 'unknown'
        const relevant = messageLooksRelevant(request, message)
        const receivedAt = this.effectiveReceivedAt(message, now, firstSeen)
        const tooOld = receivedAt !== null && receivedAt < freshnessCutoff
        const tooFuture = receivedAt !== null && receivedAt > now + 5_000
        const fresh = receivedAt !== null && !tooOld && !tooFuture

        emailDiagnostic('mailbox-provider', 'summary', {
          provider: this.config.providerLabel,
          poll,
          index,
          consumed: providerConsumed,
          excluded: requestExcluded,
          relevant,
          messageKind,
          receivedLabel: message.receivedLabel,
          timestampKnown: receivedAt !== null,
          ageMs: receivedAt === null ? null : now - receivedAt,
          fresh
        })

        if (alreadyConsumed || !relevant || !fresh || receivedAt === null) return []
        return [{ message, receivedAt }]
      })

      // Inboxes exposes trustworthy Received timestamps. Always inspect the
      // freshest eligible message first even if the site's DOM order changes.
      if (this.id === 'inboxes') {
        candidates.sort((left, right) => right.receivedAt - left.receivedAt)
      }

      emailDiagnostic('mailbox-provider', 'candidates', {
        provider: this.config.providerLabel,
        poll,
        count: candidates.length
      })

      for (const [candidateIndex, candidate] of candidates.entries()) {
        let snapshot: MailMessageSnapshot | null
        try {
          snapshot = await this.driver.readMessage(candidate.message)
        } catch {
          emailDiagnostic('mailbox-provider', 'read-error', {
            provider: this.config.providerLabel,
            poll,
            candidateIndex
          })
          return this.result(mailbox, 'provider_unavailable', `Không mở được nội dung mail trên ${this.config.providerLabel}.`)
        }
        if (!snapshot) {
          emailDiagnostic('mailbox-provider', 'read-null', {
            provider: this.config.providerLabel,
            poll,
            candidateIndex
          })
          continue
        }
        const receivedAt = Number.isFinite(snapshot.receivedAt) && snapshot.receivedAt > 0
          ? snapshot.receivedAt
          : candidate.receivedAt
        if (receivedAt < freshnessCutoff || receivedAt > this.now() + 5_000) {
          emailDiagnostic('mailbox-provider', 'snapshot-stale', {
            provider: this.config.providerLabel,
            poll,
            candidateIndex,
            ageMs: this.now() - receivedAt
          })
          continue
        }
        const match = parseVerificationCode([{ ...snapshot, receivedAt }], this.now())
        emailDiagnostic('mailbox-provider', 'parse-result', {
          provider: this.config.providerLabel,
          poll,
          candidateIndex,
          matched: match !== null,
          codeLength: match?.code.length ?? 0
        })
        if (!match) continue

        consumed.add(candidate.message.key)
        emailDiagnostic('mailbox-provider', 'success', {
          provider: this.config.providerLabel,
          poll,
          candidateIndex,
          codeLength: match.code.length
        })
        return this.result(
          mailbox,
          'success',
          `Đã lấy verification code mới từ ${this.config.providerLabel}.`,
          { code: match.code, sender: match.sender, messageKey: candidate.message.key }
        )
      }

      if (this.now() >= deadline) {
        emailDiagnostic('mailbox-provider', 'timeout', {
          provider: this.config.providerLabel,
          polls: poll,
          zeroTimeout: timeoutMs === 0
        })
        return this.result(
          mailbox,
          timeoutMs === 0 ? 'message_not_found' : 'timeout',
          timeoutMs === 0
            ? `Chưa có mail verification mới phù hợp trong mailbox ${this.config.providerLabel} hiện tại.`
            : `Hết thời gian chờ mail verification mới từ ${this.config.providerLabel}.`
        )
      }

      try {
        await this.driver.refreshMailbox()
      } catch {
        emailDiagnostic('mailbox-provider', 'refresh-error', {
          provider: this.config.providerLabel,
          poll
        })
        return this.result(mailbox, 'provider_unavailable', `Không refresh được mailbox ${this.config.providerLabel}.`)
      }
      await this.sleep(Math.min(pollMs, Math.max(1, deadline - this.now())))
    }
  }

  private effectiveReceivedAt(
    message: BrowserMailboxMessageSummary,
    now: number,
    firstSeen: Map<string, number>
  ): number | null {
    if (message.receivedAt !== null && Number.isFinite(message.receivedAt)) return message.receivedAt
    if (!this.config.useFirstSeenWhenTimestampMissing) return null

    const existing = firstSeen.get(message.key)
    if (existing !== undefined) return existing
    firstSeen.set(message.key, now)
    return now
  }

  private snapshotResult(
    mailbox: string,
    status: MailProviderMessageKeySnapshotResult['status'],
    message: string,
    messageKeys: readonly string[]
  ): MailProviderMessageKeySnapshotResult {
    return {
      providerId: this.id,
      mailbox,
      status,
      messageKeys,
      message
    }
  }

  private result(
    mailbox: string,
    status: MailProviderCodeResult['status'],
    message: string,
    detail?: { code: string; sender: string; messageKey: string }
  ): MailProviderCodeResult {
    return {
      providerId: this.id,
      mailbox,
      status,
      code: detail?.code ?? null,
      sender: detail?.sender ?? null,
      messageKey: detail?.messageKey ?? null,
      message
    }
  }
}
