import type { RuntimeSettings } from '../../shared/appSettings'
import type { RetryDisposition } from '../../shared/executionLogs'

export const MAX_RETRY_ATTEMPTS = 3

const browserRetryableCodes = new Set([
  'profile_in_use',
  'browser_launch_failed'
])

const navigationRetryableCodes = new Set([
  'page_navigation_failed',
  'page_identity_unconfirmed',
  'group_navigation_failed'
])

const safeActionRetryableCodes = new Set([
  'composer_not_found',
  'content_failed',
  'media_failed'
])

const manualReviewCodes = new Set([
  'publish_action_failed',
  'publish_unconfirmed',
  'recovery_unconfirmed',
  'worker_timeout',
  'worker_crashed',
  'unexpected_error'
])

const blockedCodes = new Set([
  'no_enabled_account',
  'account_disabled',
  'needs_login',
  'verification_required',
  'proxy_invalid',
  'proxy_unavailable',
  'group_unavailable',
  'missing_media',
  'no_content',
  'no_pending_item'
])

function isRetryableCode(errorCode: string): boolean {
  return browserRetryableCodes.has(errorCode)
    || navigationRetryableCodes.has(errorCode)
    || safeActionRetryableCodes.has(errorCode)
}

export function retryDispositionFor(errorCode: string | null | undefined): RetryDisposition {
  if (!errorCode) return 'not_applicable'
  if (isRetryableCode(errorCode)) return 'retryable'
  if (manualReviewCodes.has(errorCode)) return 'manual_review'
  if (blockedCodes.has(errorCode)) return 'blocked'
  return 'blocked'
}

export function runtimeRetryCountFor(
  errorCode: string | null | undefined,
  settings: RuntimeSettings
): number {
  if (!errorCode) return 0
  if (browserRetryableCodes.has(errorCode)) return settings.browserCrashRetryCount
  if (navigationRetryableCodes.has(errorCode)) return settings.navigationRetryCount
  if (safeActionRetryableCodes.has(errorCode)) return settings.safeActionRetryCount
  return 0
}

export function canQueueRetryWithRuntime(
  errorCode: string | null | undefined,
  attemptCount: number,
  settings: RuntimeSettings
): boolean {
  if (retryDispositionFor(errorCode) !== 'retryable') return false
  return attemptCount <= runtimeRetryCountFor(errorCode, settings)
}

export function canQueueRetry(
  errorCode: string | null | undefined,
  attemptCount: number,
  maxAttempts = MAX_RETRY_ATTEMPTS
): boolean {
  return retryDispositionFor(errorCode) === 'retryable' && attemptCount < maxAttempts
}
