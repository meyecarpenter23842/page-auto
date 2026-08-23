import { describe, expect, it } from 'vitest'
import { redactExecutionText } from './executionLogSanitizer'
import { canQueueRetry, retryDispositionFor } from './retryPolicy'

describe('Phase 8 retry policy', () => {
  it('retries only transient pre-publish failures and caps attempts', () => {
    expect(retryDispositionFor('worker_crashed')).toBe('retryable')
    expect(retryDispositionFor('page_navigation_failed')).toBe('retryable')
    expect(canQueueRetry('worker_timeout', 2)).toBe(true)
    expect(canQueueRetry('worker_timeout', 3)).toBe(false)
  })

  it('never blindly retries uncertain publish or interrupted processing', () => {
    expect(retryDispositionFor('publish_action_failed')).toBe('manual_review')
    expect(retryDispositionFor('publish_unconfirmed')).toBe('manual_review')
    expect(retryDispositionFor('recovery_unconfirmed')).toBe('manual_review')
    expect(canQueueRetry('publish_unconfirmed', 1)).toBe(false)
  })

  it('does not stack generic posting retries on top of the dedicated proxy preflight policy', () => {
    expect(retryDispositionFor('proxy_invalid')).toBe('blocked')
    expect(retryDispositionFor('proxy_unavailable')).toBe('blocked')
    expect(canQueueRetry('proxy_unavailable', 0)).toBe(false)
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
