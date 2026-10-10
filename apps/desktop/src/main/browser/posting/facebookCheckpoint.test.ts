import type { Locator, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import {
  FACEBOOK_CHECKPOINT_CLASSIFY_TIMEOUT_MS,
  classifyFacebookCommonChallengeSignals,
  detectFacebookAccountStatus,
  detectFacebookCheckpointKind,
  facebookCheckpointKindFromText,
  facebookCheckpointKindFromUrl,
  facebookRestrictionKindFromText,
  withFacebookCheckpointKind
} from './facebookCheckpoint'

function bodyLocator(text: string): Locator {
  return {
    innerText: async () => text,
    first: () => ({ isVisible: async () => false })
  } as unknown as Locator
}

function pageAt(url: string, text = ''): Page {
  return {
    url: () => url,
    locator: (selector: string) => selector === 'body'
      ? bodyLocator(text)
      : ({ first: () => ({ isVisible: async () => false }) } as unknown as Locator),
    waitForTimeout: async () => undefined
  } as unknown as Page
}

describe('Facebook checkpoint classifier', () => {
  it('recognizes the production-style checkpoint id ending in 282', () => {
    expect(facebookCheckpointKindFromUrl('https://www.facebook.com/checkpoint/1501092823525282/?next=%2F')).toBe('282')
  })

  it('recognizes checkpoint ids ending in 956 without treating unrelated checkpoint ids as known', () => {
    expect(facebookCheckpointKindFromUrl('https://www.facebook.com/checkpoint/1234567890956/')).toBe('956')
    expect(facebookCheckpointKindFromUrl('https://www.facebook.com/checkpoint/1234567890123/')).toBe('unknown')
    expect(facebookCheckpointKindFromUrl('https://www.facebook.com/two_step_verification/two_factor/')).toBeNull()
  })

  it('accepts explicit checkpoint labels from DOM text but not bare numbers', () => {
    expect(facebookCheckpointKindFromText('Checkpoint 282')).toBe('282')
    expect(facebookCheckpointKindFromText('CP: 956')).toBe('956')
    expect(facebookCheckpointKindFromText('reference 282')).toBeNull()
  })

  it('classifies the common 956 purple-lock surface from DOM text', () => {
    expect(facebookRestrictionKindFromText('Your account has been locked', '956')).toBe('956_purple_lock')
    expect(facebookRestrictionKindFromText('Tài khoản của bạn đã bị khóa', '956')).toBe('956_purple_lock')
  })

  it('classifies disabled accounts before generic checkpoint fallback', () => {
    expect(facebookRestrictionKindFromText('Your account has been disabled', 'unknown')).toBe('disabled')
    expect(facebookRestrictionKindFromText('Tài khoản của bạn đã bị vô hiệu hóa', null)).toBe('disabled')
  })

  it('adds a stable Vietnamese classification to runtime messages', () => {
    expect(withFacebookCheckpointKind('Cần xử lý thủ công.', '956_purple_lock'))
      .toBe('Cần xử lý thủ công. Phân loại: checkpoint 956 dạng khóa tím.')
    expect(withFacebookCheckpointKind('Cần xử lý thủ công.', 'disabled'))
      .toBe('Cần xử lý thủ công. Phân loại: tài khoản vô hiệu hóa.')
  })

  it('classifies common challenges from prompt + controls instead of relying on code 956', () => {
    expect(classifyFacebookCommonChallengeSignals({
      url: 'https://www.facebook.com/checkpoint/1234567890956/',
      bodyText: 'We sent a code to your email. Enter the code to continue.',
      codeInputVisible: true,
      passwordInputVisible: false,
      loginControlVisible: true
    })).toEqual({ type: 'email_code_challenge', checkpointKind: '956' })

    expect(classifyFacebookCommonChallengeSignals({
      url: 'https://www.facebook.com/two_step_verification/two_factor/',
      bodyText: 'Enter the code from your authentication app',
      codeInputVisible: true,
      passwordInputVisible: false,
      loginControlVisible: true
    })).toEqual({ type: 'totp_2fa_challenge' })
  })

  it('keeps lock and disabled as first-class account challenges', () => {
    expect(classifyFacebookCommonChallengeSignals({
      url: 'https://www.facebook.com/checkpoint/1234567890956/',
      bodyText: 'Your account has been locked',
      codeInputVisible: false,
      passwordInputVisible: false,
      loginControlVisible: false
    })).toEqual({ type: 'account_locked', checkpointKind: '956_purple_lock' })

    expect(classifyFacebookCommonChallengeSignals({
      url: 'https://www.facebook.com/checkpoint/disabled/',
      bodyText: 'Your account has been disabled',
      codeInputVisible: false,
      passwordInputVisible: false,
      loginControlVisible: false
    })).toEqual({ type: 'account_disabled', checkpointKind: 'disabled' })

    expect(classifyFacebookCommonChallengeSignals({
      url: 'https://www.facebook.com/',
      bodyText: 'Home',
      codeInputVisible: false,
      passwordInputVisible: false,
      loginControlVisible: false
    })).toEqual({ type: 'checkpoint_cleared' })
  })

  it('classifies identity review without navigating or treating it as login continuation', () => {
    expect(classifyFacebookCommonChallengeSignals({
      url: 'https://www.facebook.com/checkpoint/123/',
      bodyText: 'Confirm your identity to continue',
      codeInputVisible: false,
      passwordInputVisible: false,
      loginControlVisible: true
    }).type).toBe('identity_verification_required')
  })

  it('maps live challenge surfaces to canonical account status', async () => {
    await expect(detectFacebookAccountStatus(
      pageAt('https://www.facebook.com/checkpoint/1234567890956/', 'Your account has been locked')
    )).resolves.toBe('locked')
    await expect(detectFacebookAccountStatus(
      pageAt('https://www.facebook.com/checkpoint/1501092823525282/', 'Checkpoint')
    )).resolves.toBe('checkpoint_282')
  })

  it('classifies a known checkpoint immediately and keeps the default observation window at 10 seconds', async () => {
    expect(FACEBOOK_CHECKPOINT_CLASSIFY_TIMEOUT_MS).toBe(10_000)
    await expect(detectFacebookCheckpointKind(pageAt('https://www.facebook.com/checkpoint/1501092823525282/'))).resolves.toBe('282')
  })

  it('promotes a 956 checkpoint to purple-lock when the surface says the account is locked', async () => {
    await expect(detectFacebookCheckpointKind(
      pageAt('https://www.facebook.com/checkpoint/1234567890956/', 'Your account has been locked')
    )).resolves.toBe('956_purple_lock')
  })

  it('recognizes a disabled surface even when the URL does not expose a numeric checkpoint', async () => {
    await expect(detectFacebookCheckpointKind(
      pageAt('https://www.facebook.com/checkpoint/disabled/', 'Your account has been disabled')
    )).resolves.toBe('disabled')
  })

  it('returns unknown when the checkpoint is not identifiable instead of guessing from elapsed time', async () => {
    await expect(detectFacebookCheckpointKind(
      pageAt('https://www.facebook.com/checkpoint/1234567890123/', 'Confirm your identity'),
      0
    )).resolves.toBe('unknown')
  })
})
