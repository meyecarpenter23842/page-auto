import {
  BrowserMailboxProvider,
  type BrowserMailboxDriver,
  type BrowserMailboxProviderOptions
} from './browserMailboxProvider'
import type { MailProviderCodeRequest, MailProviderCodeResult } from './mailProvider'
import { resolveMailProviderId } from './mailProviderRegistry'

const MAILTO_PLUS_SECURITY_CODE_MIN_WAIT_MS = 25_000

export type MailtoPlusMailboxDriver = BrowserMailboxDriver
export type MailtoPlusProviderOptions = BrowserMailboxProviderOptions

export function effectiveMailtoPlusCodeTimeoutMs(request: MailProviderCodeRequest): number | undefined {
  if (request.role !== 'recovery' || request.purpose !== 'microsoft_security') return request.timeoutMs
  if (request.timeoutMs === 0) return 0
  if (request.timeoutMs !== undefined && (!Number.isFinite(request.timeoutMs) || request.timeoutMs < 0)) {
    return request.timeoutMs
  }
  return Math.max(MAILTO_PLUS_SECURITY_CODE_MIN_WAIT_MS, request.timeoutMs ?? 0)
}

/**
 * TempMail.Plus provider for the mailto.plus production target.
 *
 * The public inbox API is read through a Playwright Page owned by the existing
 * Email BrowserContext. This keeps mailbox traffic on the Email profile/proxy
 * boundary instead of introducing a Main-process fetch that could bypass it.
 * The API does not expose a timestamp contract PAGE-AUTO can safely trust here,
 * so the shared provider core uses first-seen baselining for fresh-code rounds.
 */
export class MailtoPlusProvider extends BrowserMailboxProvider<'mailto_plus'> {
  readonly resumeFreshness = 'baseline_current' as const

  constructor(driver: MailtoPlusMailboxDriver, options: MailtoPlusProviderOptions = {}) {
    super(driver, {
      ...options,
      providerId: 'mailto_plus',
      providerLabel: 'TempMail.Plus',
      supportsMailbox: (mailbox) => resolveMailProviderId(mailbox) === 'mailto_plus',
      useFirstSeenWhenTimestampMissing: true
    })
  }

  async getVerificationCode(request: MailProviderCodeRequest): Promise<MailProviderCodeResult> {
    const timeoutMs = effectiveMailtoPlusCodeTimeoutMs(request)

    return await super.getVerificationCode({
      ...request,
      ...(timeoutMs === undefined ? {} : { timeoutMs })
    })
  }
}
