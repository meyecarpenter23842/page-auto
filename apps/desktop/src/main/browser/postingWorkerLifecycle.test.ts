import { describe, expect, it } from 'vitest'
import type { FacebookPostTaskJobRequest } from '../../shared/facebookTasks'
import {
  shouldAutoReleasePostingBrowserForOneShot,
  shouldRetainPostingBrowserForManualSession
} from './postingWorkerLifecycle'

describe('shouldRetainPostingBrowserForManualSession', () => {
  it('retains browser for unresolved login and unidentified verification states', () => {
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
      code: 'verification_required',
      message: 'verification',
      sessionValidation: {
        phase: 'before_run',
        state: 'verification_required',
        message: 'checkpoint',
        checkpointKind: 'unknown'
      }
    })).toBe(true)
  })

  it.each(['282', '956'] as const)('releases browser when checkpoint %s ends the account turn', (checkpointKind) => {
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

describe('shouldAutoReleasePostingBrowserForOneShot', () => {
  const wallJob = (runId: number): FacebookPostTaskJobRequest => ({
    runId,
    task: {
      type: 'page_wall_post',
      target: { kind: 'page_wall', pageUid: '90001' }
    }
  } as FacebookPostTaskJobRequest)

  it('auto-releases only manual Page Wall run-now jobs', () => {
    expect(shouldAutoReleasePostingBrowserForOneShot(wallJob(0))).toBe(true)
    expect(shouldAutoReleasePostingBrowserForOneShot(wallJob(42))).toBe(false)

    const groupJob = {
      runId: 0,
      task: {
        type: 'group_post',
        target: { kind: 'group', groupUid: '123' }
      }
    } as FacebookPostTaskJobRequest
    expect(shouldAutoReleasePostingBrowserForOneShot(groupJob)).toBe(false)
  })
})
