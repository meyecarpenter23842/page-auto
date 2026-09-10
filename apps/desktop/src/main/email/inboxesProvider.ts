import {
  BrowserMailboxProvider,
  type BrowserEnsureMailboxResult,
  type BrowserMailboxDriver,
  type BrowserMailboxMessageSummary,
  type BrowserMailboxProviderOptions
} from './browserMailboxProvider'
import { emailDiagnostic } from './emailRuntimeDiagnostic'
import type { MailProviderCodeRequest, MailProviderCodeResult } from './mailProvider'
import { resolveMailProviderId } from './mailProviderRegistry'

const INBOXES_SECURITY_CODE_MIN_WAIT_MS = 60_000
const INBOXES_CROSS_REFRESH_MAX_WAIT_MS = 60_000
const INBOXES_TRANSIENT_REFRESH_RETRY_DELAY_MS = 500

export type InboxesMessageSummary = BrowserMailboxMessageSummary
export type InboxesEnsureMailboxResult = BrowserEnsureMailboxResult
export type InboxesMailboxDriver = BrowserMailboxDriver
export type InboxesProviderOptions = BrowserMailboxProviderOptions

/**
 * The Microsoft recovery flow calls one zero-timeout recovery probe before it
 * asks Microsoft to send a fresh code. Inboxes has trustworthy Received times,
 * so that probe must verify/open the mailbox without serially opening old mail.
 */
export function isInboxesRecoveryWarmProbe(request: MailProviderCodeRequest): boolean {
  return request.role === 'recovery'
    && request.purpose === 'microsoft_security'
    && request.timeoutMs === 0
    && request.notBefore === undefined
}

/**
 * Live Inboxes delivery is not reliably sub-12-second. Keep zero-timeout warm
 * probes unchanged, but give actual Microsoft recovery-code waits a full minute.
 * BrowserMailboxProvider still owns the hard max clamp and freshness filtering.
 */
export function effectiveInboxesCodeTimeoutMs(request: MailProviderCodeRequest): number | undefined {
  if (request.role !== 'recovery' || request.purpose !== 'microsoft_security') return request.timeoutMs
  if (request.timeoutMs === 0) return 0
  if (request.timeoutMs !== undefined && (!Number.isFinite(request.timeoutMs) || request.timeoutMs < 0)) {
    return request.timeoutMs
  }
  return Math.max(INBOXES_SECURITY_CODE_MIN_WAIT_MS, request.timeoutMs ?? 0)
}

/**
 * BrowserMailboxProvider returns a structured provider_unavailable result when
 * refreshMailbox() throws. That failure is transient on live Inboxes: the same
 * driver can often re-ensure the canonical mailbox immediately afterwards.
 */
export function isTransientInboxesRefreshFailure(result: MailProviderCodeResult): boolean {
  return result.status === 'provider_unavailable'
    && /không refresh được mailbox\s+inboxes\.com/i.test(result.message)
}

/**
 * One provider for every domain served by Inboxes.com.
 *
 * PRIMARY and RECOVERY callers share the same role-agnostic implementation.
 * The generic browser mailbox core owns polling, freshness and consumed-message
 * semantics; this class only binds the Inboxes domain family and label.
 */
export class InboxesProvider extends BrowserMailboxProvider<'inboxes'> {
  private readonly retryNow: () => number
  private readonly retrySleep: (milliseconds: number) => Promise<void>

  constructor(driver: InboxesMailboxDriver, options: InboxesProviderOptions = {}) {
    super(driver, {
      ...options,
      providerId: 'inboxes',
      providerLabel: 'Inboxes.com',
      supportsMailbox: (mailbox) => resolveMailProviderId(mailbox) === 'inboxes'
    })
    this.retryNow = options.now ?? Date.now
    this.retrySleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  }

  async getVerificationCode(request: MailProviderCodeRequest): Promise<MailProviderCodeResult> {
    if (isInboxesRecoveryWarmProbe(request)) {
      // Keep the normal ensureMailbox/listMessages verification, but make every
      // existing timestamped message ineligible so the warm probe never opens
      // historical mail one-by-one before Microsoft Send code.
      return await super.getVerificationCode({
        ...request,
        notBefore: Number.MAX_SAFE_INTEGER
      })
    }

    const timeoutMs = effectiveInboxesCodeTimeoutMs(request)
    const effectiveRequest = {
      ...request,
      ...(timeoutMs === undefined ? {} : { timeoutMs })
    }

    // Only the real Microsoft recovery wait owns the 60s cross-refresh budget.
    // Primary/non-recovery callers keep the generic provider's existing behavior.
    if (
      request.role !== 'recovery'
      || request.purpose !== 'microsoft_security'
      || timeoutMs === undefined
      || !Number.isFinite(timeoutMs)
      || timeoutMs <= 0
    ) {
      return await super.getVerificationCode(effectiveRequest)
    }

    // BrowserMailboxProvider clamps every individual polling attempt to 60s.
    // Keep that same hard maximum across refresh re-entry so multiple transient
    // failures cannot turn a caller-supplied long timeout into multiple 60s waits.
    const retryBudgetMs = Math.min(timeoutMs, INBOXES_CROSS_REFRESH_MAX_WAIT_MS)
    const deadline = this.retryNow() + retryBudgetMs
    let refreshRetry = 0

    while (true) {
      const remainingMs = Math.max(0, deadline - this.retryNow())
      const result = await super.getVerificationCode({
        ...request,
        timeoutMs: remainingMs
      })

      if (!isTransientInboxesRefreshFailure(result)) return result

      const afterFailure = this.retryNow()
      if (afterFailure >= deadline) return result

      refreshRetry += 1
      emailDiagnostic('mailbox-provider', 'refresh-retry', {
        provider: 'Inboxes.com',
        attempt: refreshRetry,
        remainingMs: Math.max(0, deadline - afterFailure)
      })

      // Re-entering BrowserMailboxProvider calls ensureMailbox() again on the
      // same driver/provider instance. This preserves provider consumed identity
      // while allowing about:blank/Home/add-inbox recovery without aborting the
      // Microsoft challenge after one transient refresh failure.
      const delayMs = Math.min(
        INBOXES_TRANSIENT_REFRESH_RETRY_DELAY_MS,
        Math.max(1, deadline - this.retryNow())
      )
      await this.retrySleep(delayMs)
    }
  }
}
