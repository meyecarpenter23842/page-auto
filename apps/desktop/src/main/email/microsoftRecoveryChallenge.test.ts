import { describe, expect, it } from 'vitest'
import { classifyMicrosoftLoginSurface } from './emailLoginPolicy'
import {
  microsoftRecoveryHintMatchesBackupEmail,
  microsoftRecoveryLocalPart,
  parseMicrosoftRecoveryEmailHints
} from './microsoftRecoveryChallenge'

const accountLiveUrl = 'https://account.live.com/identity/confirm'

describe('Microsoft recovery email challenge policy', () => {
  it('matches the audited masked recovery email only when first two characters and domain agree', () => {
    const liveText = 'Help us protect your account Email al*****@fivermail.com'
    expect(microsoftRecoveryHintMatchesBackupEmail(liveText, 'alimaisivayj57cb2401@fivermail.com')).toBe(true)
    expect(microsoftRecoveryHintMatchesBackupEmail(liveText, 'xximaisivayj57cb2401@fivermail.com')).toBe(false)
    expect(microsoftRecoveryHintMatchesBackupEmail(liveText, 'alimaisivayj57cb2401@getnada.com')).toBe(false)
  })

  it('fails closed when Microsoft exposes fewer than two useful prefix characters', () => {
    expect(parseMicrosoftRecoveryEmailHints('Email a*****@fivermail.com')).toEqual([])
    expect(microsoftRecoveryHintMatchesBackupEmail('Email a*****@fivermail.com', 'abc@fivermail.com')).toBe(false)
  })

  it('returns only the local part for the audited complete-hidden-part Microsoft input', () => {
    expect(microsoftRecoveryLocalPart('alimaisivayj57cb2401@fivermail.com')).toBe('alimaisivayj57cb2401')
    expect(microsoftRecoveryLocalPart('invalid')).toBeNull()
  })

  it('classifies the unselected Help us protect surface as recovery method choice', () => {
    expect(classifyMicrosoftLoginSurface({
      url: accountLiveUrl,
      text: "Help us protect your account Email al*****@fivermail.com I don't have these any more I have a code",
      emailInputCount: 0,
      usernameInputCount: 0,
      proofEmailInputCount: 0,
      verificationCodeInputCount: 0,
      passwordInputCount: 0,
      sendCodeControlCount: 1,
      usePasswordControlCount: 0
    })).toBe('recovery_method_choice')
  })

  it('classifies the audited complete-hidden-part surface as recovery email confirmation', () => {
    expect(classifyMicrosoftLoginSurface({
      url: accountLiveUrl,
      text: 'Help us protect your account Email al*****@fivermail.com To verify that this is your email address, complete the hidden part and click Send code to receive your code. @fivermail.com',
      emailInputCount: 1,
      usernameInputCount: 0,
      proofEmailInputCount: 1,
      verificationCodeInputCount: 0,
      passwordInputCount: 0,
      sendCodeControlCount: 1,
      usePasswordControlCount: 0
    })).toBe('recovery_email_confirmation')
  })

  it('classifies the audited email-code copy as recovery code even if Microsoft changes the input attributes', () => {
    expect(classifyMicrosoftLoginSurface({
      url: accountLiveUrl,
      text: 'Enter your security code We sent a security code to your email address.',
      emailInputCount: 0,
      usernameInputCount: 0,
      proofEmailInputCount: 0,
      verificationCodeInputCount: 0,
      passwordInputCount: 0,
      sendCodeControlCount: 0,
      usePasswordControlCount: 0
    })).toBe('recovery_code')
  })

  it('keeps authenticator and non-email security-code surfaces manual', () => {
    expect(classifyMicrosoftLoginSurface({
      url: accountLiveUrl,
      text: 'Enter the security code from your authenticator app.',
      emailInputCount: 0,
      usernameInputCount: 0,
      proofEmailInputCount: 0,
      verificationCodeInputCount: 1,
      passwordInputCount: 0,
      sendCodeControlCount: 0,
      usePasswordControlCount: 0
    })).toBe('security_review')

    expect(classifyMicrosoftLoginSurface({
      url: accountLiveUrl,
      text: 'Enter your security code We sent a text message to your phone.',
      emailInputCount: 0,
      usernameInputCount: 0,
      proofEmailInputCount: 0,
      verificationCodeInputCount: 1,
      passwordInputCount: 0,
      sendCodeControlCount: 0,
      usePasswordControlCount: 0
    })).toBe('security_review')
  })
})
