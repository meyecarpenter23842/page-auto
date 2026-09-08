import { describe, expect, it } from 'vitest'
import { classifyMicrosoftLoginSurface } from './emailLoginPolicy'
import {
  microsoftRecoveryBrowserProviderId,
  microsoftRecoveryConfirmationValue,
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

    expect(microsoftRecoveryConfirmationValue(
      'Help us protect your account Email al*****@fivermail.com To verify that this is your email address, complete the hidden part and click Send code. @fivermail.com',
      'alimaisivayj57cb2401@fivermail.com'
    )).toEqual({ mode: 'local_part', value: 'alimaisivayj57cb2401' })
  })

  it('returns the full canonical BackupEmail for the observed Verify your email form', () => {
    expect(microsoftRecoveryConfirmationValue(
      "Verify your email We'll send a code to ra*****@fviainboxes.com. To verify this is your email, enter it here. Send code",
      'random-owner@fviainboxes.com'
    )).toEqual({ mode: 'full_email', value: 'random-owner@fviainboxes.com' })
  })

  it('does not guess the full email when the masked hint or exact form copy does not match', () => {
    expect(microsoftRecoveryConfirmationValue(
      'Verify your email Send code to ra*****@fviainboxes.com',
      'random-owner@fviainboxes.com'
    )).toBeNull()
    expect(microsoftRecoveryConfirmationValue(
      'Verify your email To verify this is your email, enter it here. Send code to xx*****@fviainboxes.com',
      'random-owner@fviainboxes.com'
    )).toBeNull()
  })

  it('routes recovery mail through the central browser-provider registry instead of hard-coding Inboxes', () => {
    expect(microsoftRecoveryBrowserProviderId('owner@getnada.com')).toBe('inboxes')
    expect(microsoftRecoveryBrowserProviderId('owner@fviainboxes.com')).toBe('fvia_inboxes')
    expect(microsoftRecoveryBrowserProviderId('owner@mailto.plus')).toBe('mailto_plus')
    expect(microsoftRecoveryBrowserProviderId('owner@hotmail.com')).toBeNull()
    expect(microsoftRecoveryBrowserProviderId('owner@unknown.example')).toBeNull()
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

  it('classifies the full-email Verify your email surface as recovery email confirmation', () => {
    expect(classifyMicrosoftLoginSurface({
      url: 'https://login.live.com/oauth20_authorize.srf',
      text: "Verify your email We'll send a code to ra*****@fviainboxes.com. To verify this is your email, enter it here. Send code Already received a code? Use your password",
      emailInputCount: 1,
      usernameInputCount: 0,
      proofEmailInputCount: 1,
      verificationCodeInputCount: 0,
      passwordInputCount: 0,
      sendCodeControlCount: 1,
      usePasswordControlCount: 1
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
