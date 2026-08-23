import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../shared/appSettings'
import { redactExecutionText } from './executionLogSanitizer'
import {
  canQueueRetry,
  canQueueRetryWithRuntime,
  retryDispositionFor,
  runtimeRetryCountFor
} from './retryPolicy'

describe('runtime retry policy', () => {
  it('uses separate retry budgets for browser launch, navigation and safe pre-publish actions', () => {
    const runtime = {
      ...DEFAULT_APP_SETTINGS.runtime,
      browserCrashRetryCount: 1,
      navigationRetryCount: 2,
      safeActionRetryCount: 3
    }

    expect(runtimeRetryCountFor('browser_launch_failed', runtime)).toBe(1)
    expect(runtimeRetryCountFor('page_navigation_failed', runtime)).toBe(2)
    expect(runtimeRetryCountFor('media_failed', runtime)).toBe(3)
    expect(canQueueRetryWithRuntime('browser_launch_failed', 1, runtime)).toBe(true)
    expect(canQueueRetryWithRuntime('browser_launch_failed', 2, runtime)).toBe(false)
    expect(canQueueRetryWithRuntime('page_navigation_failed', 2, runtime)).toBe(true)
    expect(canQueueRetryWithRuntime('page_navigation_failed', 3, runtime)).toBe(false)
  })

  it('never blindly retries uncertain publish, worker interruption or unexpected failures', () => {
    expect(retryDispositionFor('publish_action_failed')).toBe('manual_review')
    expect(retryDispositionFor('publish_unconfirmed')).toBe('manual_review')
    expect(retryDispositionFor('recovery_unconfirmed')).toBe('manual_review')
    expect(retryDispositionFor('worker_timeout')).toBe('manual_review')
    expect(retryDispositionFor('worker_crashed')).toBe('manual_review')
    expect(retryDispositionFor('unexpected_error')).toBe('manual_review')
    expect(canQueueRetryWithRuntime('worker_crashed', 1, DEFAULT_APP_SETTINGS.runtime)).toBe(false)
  })

  it('keeps the legacy capped helper for manual recovery callers', () => {
    expect(retryDispositionFor('page_navigation_failed')).toBe('retryable')
    expect(canQueueRetry('page_navigation_failed', 2)).toBe(true)
    expect(canQueueRetry('page_navigation_failed', 3)).toBe(false)
  })

  it('redacts exact account secrets and key/value credentials from execution errors', () => {
    const sanitized = redactExecutionText(
      'cookie=abc123 password:pass777 proxy_pass=px999 raw pass777',
      ['pass777']
    )
    expect(sanitized).not.toContain('abc123')
    expect(sanitized).not.toContain('pass777')
    expect(sanitized).not.toContain('px999')
  })
})
