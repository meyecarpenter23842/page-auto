import { describe, expect, it } from 'vitest'
import { shouldRetainPostingBrowserForManualSession } from './postingWorkerLifecycle'

describe('shouldRetainPostingBrowserForManualSession', () => {
  it('retains browser for login and verification states from result code/status/session validation', () => {
    expect(shouldRetainPostingBrowserForManualSession({ status: 'failed', code: 'needs_login', message: 'login' })).toBe(true)
    expect(shouldRetainPostingBrowserForManualSession({ status: 'failed', code: 'verification_required', message: 'checkpoint' })).toBe(true)
    expect(shouldRetainPostingBrowserForManualSession({ status: 'needs_login', message: 'login' })).toBe(true)
    expect(shouldRetainPostingBrowserForManualSession({
      status: 'failed',
      message: 'session',
      sessionValidation: { phase: 'before_run', state: 'needs_login', message: 'login' }
    })).toBe(true)
    expect(shouldRetainPostingBrowserForManualSession({
      status: 'failed',
      message: 'verification',
      sessionValidation: { phase: 'before_run', state: 'verification_required', message: 'checkpoint' }
    })).toBe(true)
  })

  it('releases browser normally after success or unrelated posting failures', () => {
    expect(shouldRetainPostingBrowserForManualSession({ status: 'success', message: 'ok' })).toBe(false)
    expect(shouldRetainPostingBrowserForManualSession({ status: 'failed', code: 'composer_not_found', message: 'composer' })).toBe(false)
    expect(shouldRetainPostingBrowserForManualSession({
      status: 'success',
      message: 'ok',
      sessionValidation: { phase: 'before_run', state: 'valid', message: 'valid' }
    })).toBe(false)
  })
})
