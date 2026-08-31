import { describe, expect, it } from 'vitest'
import type { FacebookPostTaskJobRequest } from '../../shared/facebookTasks'
import {
  shouldAutoReleasePostingBrowserForOneShot,
  shouldRetainPostingBrowserForManualSession
} from './postingWorkerLifecycle'

describe('shouldRetainPostingBrowserForManualSession', () => {
  it('does not retain a posting browser after login/session failures', () => {
    expect(shouldRetainPostingBrowserForManualSession({ status: 'failed', code: 'needs_login', message: 'login' })).toBe(false)
    expect(shouldRetainPostingBrowserForManualSession({ status: 'needs_login', message: 'login' })).toBe(false)
    expect(shouldRetainPostingBrowserForManualSession({
      status: 'failed',
      message: 'session',
      sessionValidation: { phase: 'before_run', state: 'needs_login', message: 'login' }
    })).toBe(false)
    expect(shouldRetainPostingBrowserForManualSession({
      status: 'success',
      message: 'published',
      sessionValidation: { phase: 'after_run', state: 'needs_login', message: 'expired after publish' }
    })).toBe(false)
  })

  it.each(['282', '956', 'disabled', 'unknown'] as const)(
    'does not retain a posting browser after checkpoint %s',
    (checkpointKind) => {
      expect(shouldRetainPostingBrowserForManualSession({
        status: 'needs_login',
        code: 'verification_required',
        message: `checkpoint ${checkpointKind}`,
        sessionValidation: {
          phase: 'before_run',
          state: 'verification_required',
          message: `checkpoint ${checkpointKind}`,
          checkpointKind
        }
      })).toBe(false)
    }
  )

  it('does not retain the worker for success or unrelated posting failures either', () => {
    expect(shouldRetainPostingBrowserForManualSession({ status: 'success', message: 'ok' })).toBe(false)
    expect(shouldRetainPostingBrowserForManualSession({ status: 'failed', code: 'composer_not_found', message: 'composer' })).toBe(false)
  })
})

describe('shouldAutoReleasePostingBrowserForOneShot', () => {
  const wallJob = (executionMode: 'one_shot' | 'rotation', runId: number): FacebookPostTaskJobRequest => ({
    runId,
    executionMode,
    task: {
      type: 'page_wall_post',
      target: { kind: 'page_wall', pageUid: '90001' }
    }
  } as FacebookPostTaskJobRequest)

  it('uses the explicit lifecycle contract instead of runId=0', () => {
    expect(shouldAutoReleasePostingBrowserForOneShot(wallJob('one_shot', 0))).toBe(true)
    expect(shouldAutoReleasePostingBrowserForOneShot(wallJob('one_shot', 42))).toBe(true)
    expect(shouldAutoReleasePostingBrowserForOneShot(wallJob('rotation', 0))).toBe(false)
    expect(shouldAutoReleasePostingBrowserForOneShot(wallJob('rotation', 42))).toBe(false)
  })
})
