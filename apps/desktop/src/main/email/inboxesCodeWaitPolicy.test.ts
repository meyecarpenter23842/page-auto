import { describe, expect, it } from 'vitest'
import type { MailProviderCodeRequest } from './mailProvider'
import { effectiveInboxesCodePollMs, effectiveInboxesCodeTimeoutMs } from './inboxesProvider'
import { shouldReverifyInboxesAfterPollRecovery } from './inboxesVisibleCodeFallbackDriver'

function request(overrides: Partial<MailProviderCodeRequest> = {}): MailProviderCodeRequest {
  return {
    mailbox: 'owner@fivermail.com',
    role: 'recovery',
    purpose: 'microsoft_security',
    timeoutMs: 12_000,
    ...overrides
  }
}

describe('Inboxes live code wait policy', () => {
  it('extends the old 12-second Microsoft recovery wait to one minute', () => {
    expect(effectiveInboxesCodeTimeoutMs(request())).toBe(60_000)
  })

  it('also keeps rejected-code retries long enough for a newly delivered message', () => {
    expect(effectiveInboxesCodeTimeoutMs(request({ timeoutMs: 4_000 }))).toBe(60_000)
  })

  it('keeps the provider-owned 500ms Microsoft recovery polling policy when the router does not specify one', () => {
    expect(effectiveInboxesCodePollMs(request())).toBe(500)
    expect(effectiveInboxesCodePollMs(request({ pollIntervalMs: 750 }))).toBe(750)
    expect(effectiveInboxesCodePollMs(request({
      role: 'primary',
      purpose: 'generic_verification'
    }))).toBeUndefined()
  })

  it('preserves zero-timeout warm probes and unrelated verification timeouts', () => {
    expect(effectiveInboxesCodeTimeoutMs(request({ timeoutMs: 0 }))).toBe(0)
    expect(effectiveInboxesCodeTimeoutMs(request({
      role: 'primary',
      purpose: 'generic_verification',
      timeoutMs: 12_000
    }))).toBe(12_000)
  })

  it('re-verifies the canonical mailbox after a dismissed vignette or ad popup', () => {
    expect(shouldReverifyInboxesAfterPollRecovery('dismissed', 0)).toBe(true)
    expect(shouldReverifyInboxesAfterPollRecovery('none', 1)).toBe(true)
    expect(shouldReverifyInboxesAfterPollRecovery('none', 0)).toBe(false)
  })
})
