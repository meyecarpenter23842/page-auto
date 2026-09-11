import { describe, expect, it } from 'vitest'
import type { EmailRecoveryRoundContract } from './emailAuthV2Contracts'
import { classifyMicrosoftLoginSurface } from './emailLoginPolicy'
import {
  createMicrosoftRecoveryRound,
  microsoftRecoveryBrowserProviderId,
  microsoftRecoveryCodeChallengeMatchesBackupEmail,
  microsoftRecoveryCodeInputParts,
  microsoftRecoveryCodeWasRejected,
  microsoftRecoveryConfirmationValue,
  microsoftRecoveryHintMatchesBackupEmail,
  microsoftRecoveryLocalPart,
  microsoftRecoveryRecordSubmittedCode,
  microsoftRecoveryRequiresResumeMailboxBaseline,
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

  it('baselines timestamp-less providers before accepting mail on a resumed code screen', () => {
    expect(microsoftRecoveryRequiresResumeMailboxBaseline('fvia_inboxes')).toBe(true)
    expect(microsoftRecoveryRequiresResumeMailboxBaseline('mailto_plus')).toBe(true)
    expect(microsoftRecoveryRequiresResumeMailboxBaseline('inboxes')).toBe(false)
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

  it('keeps the actionable Verify your email recovery form authoritative even when Use your password is visible', () => {
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

  it('keeps Verify your email in recovery when Microsoft does not offer the password path', () => {
    expect(classifyMicrosoftLoginSurface({
      url: 'https://login.live.com/oauth20_authorize.srf',
      text: "Verify your email We'll send a code to ra*****@fviainboxes.com. To verify this is your email, enter it here. Send code",
      emailInputCount: 1,
      usernameInputCount: 0,
      proofEmailInputCount: 1,
      verificationCodeInputCount: 0,
      passwordInputCount: 0,
      sendCodeControlCount: 1,
      usePasswordControlCount: 0
    })).toBe('recovery_email_confirmation')
  })

  it('classifies both audited email-code wordings as recovery code before password fallback', () => {
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

    expect(classifyMicrosoftLoginSurface({
      url: 'https://login.live.com/oauth20_authorize.srf',
      text: "Enter your code If uzprwtnyd973b2401@fivermail.com matches the email address on your account, we'll send you a code. Use your password",
      emailInputCount: 0,
      usernameInputCount: 0,
      proofEmailInputCount: 0,
      verificationCodeInputCount: 6,
      passwordInputCount: 0,
      sendCodeControlCount: 0,
      usePasswordControlCount: 1
    })).toBe('recovery_code')
  })

  it('validates a resumed code screen against canonical BackupEmail before reading mail', () => {
    const liveText = "Enter your code If uzprwtnyd973b2401@fivermail.com matches the email address on your account, we'll send you a code."
    expect(microsoftRecoveryCodeChallengeMatchesBackupEmail(
      liveText,
      'uzprwtnyd973b2401@fivermail.com'
    )).toBe(true)
    expect(microsoftRecoveryCodeChallengeMatchesBackupEmail(
      liveText,
      'another-owner@fivermail.com'
    )).toBe(false)

    const suffixCollision = "Enter your code If otherowner@example.com matches the email address on your account, we'll send you a code."
    expect(microsoftRecoveryCodeChallengeMatchesBackupEmail(suffixCollision, 'owner@example.com')).toBe(false)
    expect(microsoftRecoveryCodeChallengeMatchesBackupEmail(suffixCollision, 'otherowner@example.com')).toBe(true)
  })

  it('supports both a single OTP field and the six-box code UI from the live flow', () => {
    expect(microsoftRecoveryCodeInputParts('112974', 1)).toEqual(['112974'])
    expect(microsoftRecoveryCodeInputParts('112974', 6)).toEqual(['1', '1', '2', '9', '7', '4'])
    expect(microsoftRecoveryCodeInputParts('112974', 5)).toBeNull()
    expect(microsoftRecoveryCodeInputParts('123', 3)).toBeNull()
  })

  it('recognizes the live Microsoft rejected-code copy so the round can exclude the submitted message', () => {
    expect(microsoftRecoveryCodeWasRejected("That code didn't work. Check the code and try again.")).toBe(true)
    expect(microsoftRecoveryCodeWasRejected('Enter your security code')).toBe(false)
  })

  it('seeds every new round with the pre-Send baseline and session-consumed history', () => {
    const first = createMicrosoftRecoveryRound(
      'owner@getnada.com',
      'inboxes',
      1000,
      ['mail-before-send', 'notification-before-send'],
      ['submitted-a']
    )
    expect(first.baselineMessageKeys).toEqual(['mail-before-send', 'notification-before-send'])
    expect(first.consumedMessageKeys).toEqual(['submitted-a'])

    const second = createMicrosoftRecoveryRound(
      'owner@getnada.com',
      'inboxes',
      1002,
      ['mail-before-send', 'submitted-a'],
      [...first.consumedMessageKeys, 'submitted-b']
    )
    expect(second.consumedMessageKeys).toEqual(['submitted-a', 'submitted-b'])
    expect(second.baselineMessageKeys).toContain('submitted-a')
  })

  it('keeps durable consumed message metadata without storing the plaintext code', () => {
    const round: EmailRecoveryRoundContract = {
      challengeId: 'challenge-live',
      mailbox: 'owner@getnada.com',
      providerId: 'inboxes',
      requestedAt: 123,
      baselineMessageKeys: ['mail-before-send'],
      consumedMessageKeys: ['old-mail'],
      lastSubmittedMessageKey: null,
      lastSubmittedCodeFingerprint: null,
      submitAttempts: 0
    }

    const updated = microsoftRecoveryRecordSubmittedCode(round, 'fresh-mail', '481726')
    expect(updated.consumedMessageKeys).toEqual(['old-mail', 'fresh-mail'])
    expect(updated.lastSubmittedMessageKey).toBe('fresh-mail')
    expect(updated.lastSubmittedCodeFingerprint).toBeTruthy()
    expect(updated.lastSubmittedCodeFingerprint).not.toBe('481726')
    expect(updated.submitAttempts).toBe(1)
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
