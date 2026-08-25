import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS, type SessionSettings } from '../../shared/appSettings'
import type { PostingJobResult } from '../../shared/posting'
import { resolveSessionFailureDecision } from './sessionFailurePolicy'

function settings(patch: Partial<SessionSettings> = {}): SessionSettings {
  return { ...DEFAULT_APP_SETTINGS.session, ...patch }
}

describe('resolveSessionFailureDecision', () => {
  it('continues to the next account for expired sessions by default', () => {
    const result: PostingJobResult = { status: 'needs_login', code: 'needs_login', message: 'expired' }
    expect(resolveSessionFailureDecision(result, settings())).toEqual({ kind: 'session_expired', action: 'continue' })
  })

  it('can pause the Page Tab for expired sessions', () => {
    const result: PostingJobResult = { status: 'needs_login', code: 'needs_login', message: 'expired' }
    expect(resolveSessionFailureDecision(result, settings({ onSessionExpired: 'needs_login_stop' }))).toEqual({
      kind: 'session_expired',
      action: 'stop'
    })
  })

  it('always pauses the Page Tab while the current account still has unresolved 2FA', () => {
    const result: PostingJobResult = {
      status: 'needs_login',
      code: 'needs_login',
      message: 'Đã nhập mã 2FA nhưng Facebook chưa xác nhận session; cần kiểm tra thủ công trên browser.'
    }
    expect(resolveSessionFailureDecision(result, settings({ onSessionExpired: 'needs_login_continue' }))).toEqual({
      kind: 'session_expired',
      action: 'stop'
    })
  })

  it('uses the checkpoint policy for identity verification', () => {
    const result: PostingJobResult = {
      status: 'needs_login',
      code: 'verification_required',
      message: 'manual checkpoint',
      sessionValidation: { phase: 'before_run', state: 'verification_required', message: 'manual checkpoint' }
    }
    expect(resolveSessionFailureDecision(result, settings({ onCheckpoint: 'needs_login_stop' }))).toEqual({
      kind: 'checkpoint',
      action: 'stop'
    })
  })

  it('detects a post-run session expiration without changing a successful publish result', () => {
    const result: PostingJobResult = {
      status: 'success',
      message: 'published',
      sessionValidation: { phase: 'after_run', state: 'needs_login', message: 'expired after publish' }
    }
    expect(resolveSessionFailureDecision(result, settings())).toEqual({ kind: 'session_expired', action: 'continue' })
    expect(result.status).toBe('success')
  })
})