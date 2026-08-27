import { describe, expect, it } from 'vitest'
import { classifyMicrosoftLoginSurface, classifyMicrosoftRoute } from './emailLoginPolicy'

const consumerAuthorizeUrl = 'https://login.live.com/oauth20_authorize.srf?client_id=9199bf20-a13f-4107-85dc-02114787ef48&state=dynamic-state&nonce=dynamic-nonce&code_challenge=dynamic-challenge&username=canonical%40hotmail.com&login_hint=canonical%40hotmail.com'

describe('Microsoft route-first state machine regression', () => {
  it('keeps dynamic OAuth query values out of route classification', () => {
    expect(classifyMicrosoftRoute(consumerAuthorizeUrl)).toBe('login_oauth')
    expect(classifyMicrosoftRoute('https://login.live.com/oauth20_authorize.srf?state=another&epct=rotating')).toBe('login_oauth')
    expect(classifyMicrosoftRoute('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=dynamic&nonce=dynamic')).toBe('login_oauth')
    expect(classifyMicrosoftRoute('https://outlook.live.com/mail/0/inbox')).toBe('outlook_mail')
  })

  it('distinguishes account picker, username and password on the same OAuth route', () => {
    expect(classifyMicrosoftLoginSurface({
      url: consumerAuthorizeUrl,
      text: 'Pick an account Use another account',
      emailInputCount: 0,
      usernameInputCount: 0,
      proofEmailInputCount: 0,
      verificationCodeInputCount: 0,
      passwordInputCount: 0,
      useAnotherAccountControlCount: 1,
      sendCodeControlCount: 0,
      usePasswordControlCount: 0
    })).toBe('account_picker')

    expect(classifyMicrosoftLoginSurface({
      url: consumerAuthorizeUrl,
      text: 'Sign in Email, phone, or Skype',
      emailInputCount: 1,
      usernameInputCount: 1,
      proofEmailInputCount: 0,
      verificationCodeInputCount: 0,
      passwordInputCount: 0,
      useAnotherAccountControlCount: 0,
      sendCodeControlCount: 0,
      usePasswordControlCount: 0
    })).toBe('username')

    expect(classifyMicrosoftLoginSurface({
      url: consumerAuthorizeUrl,
      text: 'Enter password',
      emailInputCount: 0,
      usernameInputCount: 0,
      proofEmailInputCount: 0,
      verificationCodeInputCount: 0,
      passwordInputCount: 1,
      useAnotherAccountControlCount: 0,
      sendCodeControlCount: 0,
      usePasswordControlCount: 0
    })).toBe('password')
  })

  it('treats recovery-email proof with Use your password as a supported method choice', () => {
    expect(classifyMicrosoftLoginSurface({
      url: consumerAuthorizeUrl,
      text: "Verify your email We'll send a code to sa*****@recovery.example. To verify this is your email, enter it here. Send code Already received a code? Use your password",
      emailInputCount: 1,
      usernameInputCount: 0,
      proofEmailInputCount: 1,
      verificationCodeInputCount: 0,
      passwordInputCount: 0,
      useAnotherAccountControlCount: 0,
      sendCodeControlCount: 1,
      usePasswordControlCount: 1
    })).toBe('password_method_choice')
  })

  it('matches the live Verify your email method choice even when the recovery field is not type=email', () => {
    expect(classifyMicrosoftLoginSurface({
      url: consumerAuthorizeUrl,
      text: 'Verify your email\nWe’ll send a code to sa*****@recovery.example.\nSend code\nAlready received a code?\nUse your password',
      emailInputCount: 0,
      usernameInputCount: 0,
      proofEmailInputCount: 0,
      verificationCodeInputCount: 0,
      passwordInputCount: 0,
      useAnotherAccountControlCount: 0,
      sendCodeControlCount: 1,
      usePasswordControlCount: 1
    })).toBe('password_method_choice')
  })

  it('keeps recovery-email proof terminal when password fallback is not available', () => {
    expect(classifyMicrosoftLoginSurface({
      url: consumerAuthorizeUrl,
      text: "Verify your email We'll send a code to sa*****@recovery.example. To verify this is your email, enter it here. Send code Already received a code?",
      emailInputCount: 1,
      usernameInputCount: 0,
      proofEmailInputCount: 1,
      verificationCodeInputCount: 0,
      passwordInputCount: 0,
      useAnotherAccountControlCount: 0,
      sendCodeControlCount: 1,
      usePasswordControlCount: 0
    })).toBe('security_review')
  })

  it('prioritizes a real password field over a nearby Send a code fallback link', () => {
    expect(classifyMicrosoftLoginSurface({
      url: consumerAuthorizeUrl,
      text: 'Enter your password Password Next Send a code to sa*****@recovery.example',
      emailInputCount: 0,
      usernameInputCount: 0,
      proofEmailInputCount: 0,
      verificationCodeInputCount: 0,
      passwordInputCount: 1,
      useAnotherAccountControlCount: 0,
      sendCodeControlCount: 1,
      usePasswordControlCount: 0
    })).toBe('password')
  })

  it('treats an OTP input on the OAuth route as security review even if the URL did not change', () => {
    expect(classifyMicrosoftLoginSurface({
      url: consumerAuthorizeUrl,
      text: 'Enter the code',
      emailInputCount: 0,
      usernameInputCount: 0,
      proofEmailInputCount: 0,
      verificationCodeInputCount: 1,
      passwordInputCount: 0,
      useAnotherAccountControlCount: 0,
      sendCodeControlCount: 0,
      usePasswordControlCount: 0
    })).toBe('security_review')
  })

  it('never treats an arbitrary non-login email input as the canonical username field', () => {
    expect(classifyMicrosoftLoginSurface({
      url: consumerAuthorizeUrl,
      text: 'Continue',
      emailInputCount: 1,
      usernameInputCount: 0,
      proofEmailInputCount: 1,
      verificationCodeInputCount: 0,
      passwordInputCount: 0,
      useAnotherAccountControlCount: 0,
      sendCodeControlCount: 0,
      usePasswordControlCount: 0
    })).toBe('oauth_authorize')
  })

  it('retries inline invalid-email validation only when the real username marker is present', () => {
    expect(classifyMicrosoftLoginSurface({
      url: consumerAuthorizeUrl,
      text: 'Enter a valid email address, phone number, or Skype name.',
      emailInputCount: 1,
      usernameInputCount: 1,
      proofEmailInputCount: 0,
      verificationCodeInputCount: 0,
      passwordInputCount: 0
    })).toBe('username')

    expect(classifyMicrosoftLoginSurface({
      url: consumerAuthorizeUrl,
      text: 'Enter a valid email address, phone number, or Skype name.',
      emailInputCount: 1,
      usernameInputCount: 0,
      proofEmailInputCount: 1,
      verificationCodeInputCount: 0,
      passwordInputCount: 0
    })).toBe('credential_error')
  })
})
