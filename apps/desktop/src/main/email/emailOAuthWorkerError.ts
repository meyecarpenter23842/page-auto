import { friendlyEmailBrowserError } from './emailBrowserLifecycle'

/**
 * Browser/profile startup errors deserve the friendly lifecycle message. Once a
 * browser context is already available, however, an OAuth/Microsoft-auth failure
 * must keep its real message instead of being mislabeled as a browser launch
 * failure (for example credential_error, security_review, or account.live.com/Abuse).
 */
export function emailOAuthWorkerErrorMessage(error: unknown, browserReady: boolean): string {
  if (!browserReady) return friendlyEmailBrowserError(error)
  return error instanceof Error ? error.message : String(error)
}
