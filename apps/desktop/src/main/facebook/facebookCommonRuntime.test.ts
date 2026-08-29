import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  beforeRunFacebookEmailSupportFailure,
  beforeRunFacebookSessionFailure,
  classifyFacebookBrowserLaunchFailure
} from './facebookCommonRuntime'

describe('Facebook common runtime', () => {
  it('classifies a busy persistent profile without leaking browser-specific handling to business tasks', () => {
    expect(classifyFacebookBrowserLaunchFailure('User data directory is already in use')).toEqual({
      status: 'failed',
      code: 'profile_in_use',
      message: 'Browser profile đang được mở ở process khác.'
    })
    expect(classifyFacebookBrowserLaunchFailure('spawn failed')).toEqual({
      status: 'failed',
      code: 'browser_launch_failed',
      message: 'spawn failed'
    })
  })

  it('maps checkpoint session preparation to manual verification', () => {
    const session = {
      accountId: 9,
      status: 'needs_login',
      reason: 'checkpoint',
      cookie: null,
      cookieStatus: 'needs_login',
      lastCookieCheck: 1,
      message: 'checkpoint'
    } as Parameters<typeof beforeRunFacebookSessionFailure>[0]

    expect(beforeRunFacebookSessionFailure(session)).toEqual({
      status: 'needs_login',
      code: 'verification_required',
      message: 'checkpoint',
      sessionValidation: {
        phase: 'before_run',
        state: 'verification_required',
        message: 'checkpoint'
      }
    })
  })

  it('preserves checkpoint 282 as typed Common state without treating it as a generic login error', () => {
    const session = {
      accountId: 12,
      status: 'needs_login',
      reason: 'checkpoint',
      cookie: null,
      cookieStatus: 'needs_login',
      lastCookieCheck: 1,
      message: 'Facebook yêu cầu checkpoint 282.'
    } as Parameters<typeof beforeRunFacebookSessionFailure>[0]

    expect(beforeRunFacebookSessionFailure(session, '282')).toEqual({
      status: 'needs_login',
      code: 'verification_required',
      message: 'Facebook yêu cầu checkpoint 282.',
      sessionValidation: {
        phase: 'before_run',
        state: 'verification_required',
        message: 'Facebook yêu cầu checkpoint 282.',
        checkpointKind: '282'
      }
    })
  })

  it('keeps Email Support failures typed instead of converting them to a generic checkpoint', () => {
    expect(beforeRunFacebookEmailSupportFailure('email_auth_expired', 'OAuth cần kết nối lại.')).toEqual({
      status: 'needs_login',
      code: 'email_auth_expired',
      message: 'OAuth cần kết nối lại.',
      sessionValidation: {
        phase: 'before_run',
        state: 'needs_login',
        message: 'OAuth cần kết nối lại.'
      }
    })
  })

  it('keeps Group posting free of shared login, identity and pacing implementations', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const postingEngine = readFileSync(resolve(here, '../browser/posting/postingEngine.ts'), 'utf8')
    const commonRuntime = readFileSync(resolve(here, 'facebookCommonRuntime.ts'), 'utf8')
    const interactionPacing = readFileSync(resolve(here, 'facebookInteractionPacing.ts'), 'utf8')

    for (const forbidden of [
      'chromium.launchPersistentContext',
      'bootstrapFacebookSession',
      'validateFacebookSession',
      'inspectFacebookAccountIdentity',
      'PageIdentitySwitcher',
      'activeFacebookProfileId'
    ]) {
      expect(postingEngine).not.toContain(forbidden)
      expect(commonRuntime).toContain(forbidden)
    }

    expect(postingEngine).not.toContain('randomBrowserActionDelayMs')
    expect(postingEngine).toContain('FacebookCommonRuntime.open')
    expect(postingEngine).toContain('GroupNavigator')
    expect(postingEngine).toContain('PublishResultDetector')
    expect(commonRuntime).toContain('createPacedFacebookPage')
    expect(commonRuntime).toContain('withoutFacebookInteractionPacing')
    expect(interactionPacing).toContain('randomBrowserActionDelayMs')
    expect(commonRuntime).toContain('bootstrapFacebookSessionWithEmailSupport')
    expect(commonRuntime).toContain('detectFacebookCheckpointKind')
    expect(commonRuntime).not.toContain('groupUid')
    expect(commonRuntime).not.toContain('my_posted_content')
  })
})
