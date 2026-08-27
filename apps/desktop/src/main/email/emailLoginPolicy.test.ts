import { describe, expect, it } from 'vitest'
import {
  classifyMicrosoftLoginSurface,
  nextEmailAuthResumeKind,
  shouldResumeEmailActionAfterAuth
} from './emailLoginPolicy'

describe('email Microsoft login policy', () => {
  it('classifies the supported Microsoft sign-in surfaces without exposing credentials', () => {
    expect(classifyMicrosoftLoginSurface({
      url: 'https://login.live.com/',
      text: 'Sign in',
      emailInputCount: 1,
      passwordInputCount: 0
    })).toBe('username')
    expect(classifyMicrosoftLoginSurface({
      url: 'https://login.live.com/',
      text: 'Enter password',
      emailInputCount: 0,
      passwordInputCount: 1
    })).toBe('password')
    expect(classifyMicrosoftLoginSurface({
      url: 'https://account.live.com/password/Change',
      text: 'Current password New password Reenter password',
      emailInputCount: 0,
      passwordInputCount: 3
    })).toBe('password_change')
    expect(classifyMicrosoftLoginSurface({
      url: 'https://login.live.com/',
      text: 'Your account or password is incorrect.',
      emailInputCount: 0,
      passwordInputCount: 1
    })).toBe('credential_error')
    expect(classifyMicrosoftLoginSurface({
      url: 'https://login.live.com/',
      text: 'Enter the security code from your authenticator app.',
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('security_review')
    expect(classifyMicrosoftLoginSurface({
      url: 'https://account.live.com/',
      text: 'Verify your identity',
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('identity_review')
    expect(classifyMicrosoftLoginSurface({
      url: 'https://login.live.com/',
      text: 'Stay signed in?',
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('stay_signed_in')
    expect(classifyMicrosoftLoginSurface({
      url: 'https://www.microsoft.com/en-us/microsoft-365/outlook/email-and-calendar-software-microsoft-outlook?deeplink=%2Fmail%2F0%2F&sdf=0&sessionId=test',
      text: 'Your inbox, organized. Sign in Download Create free account. Open Outlook',
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('outlook_landing')
    expect(classifyMicrosoftLoginSurface({
      url: 'https://outlook.live.com/mail/0/',
      text: 'Inbox',
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('authenticated')
    expect(classifyMicrosoftLoginSurface({
      url: 'https://account.live.com/proofs/manage/additional',
      text: 'Security',
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('authenticated')
  })

  it('classifies Microsoft Online OAuth authorize without hardcoding per-run OAuth values', () => {
    const authorizeUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=test-client&response_type=code&state=dynamic-state&nonce=dynamic-nonce&code_challenge=dynamic-challenge&prompt=select_account'

    expect(classifyMicrosoftLoginSurface({
      url: authorizeUrl,
      text: 'Pick an account Use another account',
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('oauth_authorize')
    expect(classifyMicrosoftLoginSurface({
      url: authorizeUrl,
      text: 'Sign in',
      emailInputCount: 1,
      passwordInputCount: 0
    })).toBe('username')
    expect(classifyMicrosoftLoginSurface({
      url: authorizeUrl,
      text: 'Enter the security code',
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('security_review')
  })

  it('does not treat blank or unknown pages as an authenticated Microsoft session', () => {
    expect(classifyMicrosoftLoginSurface({
      url: 'about:blank',
      text: '',
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('manual_login')
    expect(classifyMicrosoftLoginSurface({
      url: 'https://example.test/',
      text: '',
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('manual_login')
  })

  it('resumes an action after auth attention instead of treating auth completion as business completion', () => {
    expect(nextEmailAuthResumeKind('recovery-result', 'needs_attention', 'needs_login')).toBe('recovery-result')
    expect(nextEmailAuthResumeKind('password-result', 'needs_attention', 'security_review')).toBe('password-result')
    expect(shouldResumeEmailActionAfterAuth('recovery-result', 'recovery-result', true)).toBe(true)
    expect(shouldResumeEmailActionAfterAuth('password-result', 'password-result', true)).toBe(true)
  })

  it('clears auth-resume mode once the real action reaches manual completion or a terminal result', () => {
    expect(nextEmailAuthResumeKind('recovery-result', 'needs_attention', 'manual_completion_required')).toBeNull()
    expect(nextEmailAuthResumeKind('password-result', 'success', undefined)).toBeNull()
    expect(nextEmailAuthResumeKind('password-result', 'error', undefined)).toBeNull()
    expect(shouldResumeEmailActionAfterAuth(null, 'password-result', true)).toBe(false)
    expect(shouldResumeEmailActionAfterAuth('password-result', 'password-result', false)).toBe(false)
  })
})
