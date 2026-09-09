import { describe, expect, it } from 'vitest'
import {
  classifyMicrosoftLoginSurface,
  shouldResumeMicrosoftAuthSurface
} from './emailLoginPolicy'

const identityConfirmUrl = 'https://account.live.com/identity/confirm'

describe('Microsoft identity/confirm regression', () => {
  it('keeps a blank identity confirmation shell transitional instead of authenticated', () => {
    const surface = classifyMicrosoftLoginSurface({
      url: identityConfirmUrl,
      text: '',
      emailInputCount: 0,
      passwordInputCount: 0
    })

    expect(surface).toBe('login_transition')
    expect(shouldResumeMicrosoftAuthSurface(surface)).toBe(true)
  })

  it('keeps a loading identity confirmation shell transitional instead of authenticated', () => {
    expect(classifyMicrosoftLoginSurface({
      url: identityConfirmUrl,
      text: 'Loading...',
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('login_transition')
  })

  it('detects the live Keep your account secure identity review once Microsoft hydrates the page', () => {
    expect(classifyMicrosoftLoginSurface({
      url: identityConfirmUrl,
      text: "Keep your account secure We've noticed some unusual activity. Verify your identity",
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('identity_review')
  })

  it('detects the masked recovery method choice on identity/confirm', () => {
    expect(classifyMicrosoftLoginSurface({
      url: identityConfirmUrl,
      text: 'Help us protect your account sa*****@recovery.example',
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('recovery_method_choice')
  })

  it('detects the recovery email confirmation form on identity/confirm', () => {
    expect(classifyMicrosoftLoginSurface({
      url: identityConfirmUrl,
      text: 'Help us protect your account sa*****@recovery.example Complete the hidden part and send code',
      emailInputCount: 1,
      usernameInputCount: 0,
      proofEmailInputCount: 1,
      verificationCodeInputCount: 0,
      passwordInputCount: 0,
      sendCodeControlCount: 1
    })).toBe('recovery_email_confirmation')
  })

  it('detects audited recovery-email security code evidence on identity/confirm', () => {
    expect(classifyMicrosoftLoginSurface({
      url: identityConfirmUrl,
      text: 'Enter your security code. We sent a code to your email address.',
      emailInputCount: 0,
      proofEmailInputCount: 0,
      verificationCodeInputCount: 1,
      passwordInputCount: 0
    })).toBe('recovery_code')
  })

  it('keeps a generic OTP challenge outside audited recovery-email automation', () => {
    expect(classifyMicrosoftLoginSurface({
      url: identityConfirmUrl,
      text: 'Enter the code from your authenticator app',
      emailInputCount: 0,
      proofEmailInputCount: 0,
      verificationCodeInputCount: 1,
      passwordInputCount: 0
    })).toBe('security_review')
  })

  it('preserves the known-safe Recovery business target as authenticated', () => {
    expect(classifyMicrosoftLoginSurface({
      url: 'https://account.live.com/proofs/manage/additional',
      text: 'Security',
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('authenticated')
  })

  it('does not treat arbitrary account.live.com pages as authenticated by hostname alone', () => {
    expect(classifyMicrosoftLoginSurface({
      url: 'https://account.live.com/unknown/surface',
      text: '',
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('manual_login')
  })
})
