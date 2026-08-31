import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS, type SessionSettings } from '../../shared/appSettings'
import type { PostingJobResult } from '../../shared/posting'
import { resolveSessionFailureDecision } from './sessionFailurePolicy'

function settings(patch: Partial<SessionSettings> = {}): SessionSettings {
  return { ...DEFAULT_APP_SETTINGS.session, ...patch }
}

describe('resolveSessionFailureDecision', () => {
  it('continues to the next account for a generic expired session even when the legacy setting says stop', () => {
    const result: PostingJobResult = { status: 'needs_login', code: 'needs_login', message: 'expired' }
    expect(resolveSessionFailureDecision(result, settings({ onSessionExpired: 'needs_login_stop' }))).toEqual({
      kind: 'session_expired',
      action: 'continue'
    })
  })

  it('treats unresolved before-run login as an account-turn failure instead of pausing the Page Tab', () => {
    const result: PostingJobResult = {
      status: 'needs_login',
      code: 'needs_login',
      message: 'auto login did not finish',
      sessionValidation: {
        phase: 'before_run',
        state: 'needs_login',
        message: 'Facebook vẫn đang ở màn đăng nhập/2FA.'
      }
    }
    expect(resolveSessionFailureDecision(result, settings({ onSessionExpired: 'needs_login_stop' }))).toEqual({
      kind: 'session_expired',
      action: 'continue'
    })
  })

  it.each(['282', '956', 'disabled', 'unknown'] as const)(
    'ends only the current account turn for checkpoint %s',
    (checkpointKind) => {
      const result: PostingJobResult = {
        status: 'needs_login',
        code: 'verification_required',
        message: `checkpoint ${checkpointKind}`,
        sessionValidation: {
          phase: 'before_run',
          state: 'verification_required',
          message: `checkpoint ${checkpointKind}`,
          checkpointKind
        }
      }
      expect(resolveSessionFailureDecision(result, settings({ onCheckpoint: 'needs_login_stop' }))).toEqual({
        kind: 'checkpoint',
        action: 'continue'
      })
    }
  )

  it('continues for an unclassified verification result instead of pausing the whole Page Tab', () => {
    const result: PostingJobResult = {
      status: 'needs_login',
      code: 'verification_required',
      message: 'manual checkpoint',
      sessionValidation: { phase: 'before_run', state: 'verification_required', message: 'manual checkpoint' }
    }
    expect(resolveSessionFailureDecision(result, settings({ onCheckpoint: 'needs_login_stop' }))).toEqual({
      kind: 'checkpoint',
      action: 'continue'
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

  it('ignores unrelated posting failures', () => {
    const result: PostingJobResult = { status: 'failed', code: 'composer_not_found', message: 'composer' }
    expect(resolveSessionFailureDecision(result, settings())).toBeNull()
  })
})
