import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS, type SessionSettings } from '../../shared/appSettings'
import type { PostingJobResult } from '../../shared/posting'
import { resolveSessionFailureDecision } from './sessionFailurePolicy'

function settings(patch: Partial<SessionSettings> = {}): SessionSettings {
  return { ...DEFAULT_APP_SETTINGS.session, ...patch }
}

describe('resolveSessionFailureDecision', () => {
  it('continues to the next account for a generic expired session by default', () => {
    const result: PostingJobResult = { status: 'needs_login', code: 'needs_login', message: 'expired' }
    expect(resolveSessionFailureDecision(result, settings())).toEqual({ kind: 'session_expired', action: 'continue' })
  })

  it('can pause the Page Tab for generic expired sessions', () => {
    const result: PostingJobResult = { status: 'needs_login', code: 'needs_login', message: 'expired' }
    expect(resolveSessionFailureDecision(result, settings({ onSessionExpired: 'needs_login_stop' }))).toEqual({
      kind: 'session_expired',
      action: 'stop'
    })
  })

  it('always pauses unresolved before-run login repair so the next account cannot open beside the retained browser', () => {
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
    expect(resolveSessionFailureDecision(result, settings({ onSessionExpired: 'needs_login_continue' }))).toEqual({
      kind: 'session_expired',
      action: 'stop'
    })
  })

  it.each(['282', '956'] as const)('treats checkpoint %s as a terminal account turn even when the legacy checkpoint setting says stop', (checkpointKind) => {
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
  })

  it('always pauses an unidentified checkpoint instead of rotating by the legacy continue setting', () => {
    const result: PostingJobResult = {
      status: 'needs_login',
      code: 'verification_required',
      message: 'manual checkpoint',
      sessionValidation: {
        phase: 'before_run',
        state: 'verification_required',
        message: 'manual checkpoint',
        checkpointKind: 'unknown'
      }
    }
    expect(resolveSessionFailureDecision(result, settings({ onCheckpoint: 'needs_login_continue' }))).toEqual({
      kind: 'checkpoint',
      action: 'stop'
    })
  })

  it('pauses an unclassified verification result instead of assuming it is 282/956', () => {
    const result: PostingJobResult = {
      status: 'needs_login',
      code: 'verification_required',
      message: 'manual checkpoint',
      sessionValidation: { phase: 'before_run', state: 'verification_required', message: 'manual checkpoint' }
    }
    expect(resolveSessionFailureDecision(result, settings({ onCheckpoint: 'needs_login_continue' }))).toEqual({
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
