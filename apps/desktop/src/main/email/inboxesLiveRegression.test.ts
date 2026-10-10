import { describe, expect, it } from 'vitest'
import { parseVerificationCode } from './verificationCodeParser'
import {
  classifyInboxesBackgroundSurface,
  inboxesBodyHasMessageDetail,
  inboxesPreviewSnapshot,
  shouldUseInboxesAddInboxFastPath,
  type InboxesBackgroundSurfaceSnapshot
} from './inboxesBackgroundPlaywrightDriver'
import { shouldTreatInboxesVignetteAsBlocking } from './inboxesVignetteGuard'
import type { InboxesMessageSummary } from './inboxesProvider'

function snapshot(overrides: Partial<InboxesBackgroundSurfaceSnapshot> = {}): InboxesBackgroundSurfaceSnapshot {
  return {
    pageClosed: false,
    bodyText: '',
    expectedMailbox: 'owner@getnada.com',
    activeMailbox: null,
    lastKnownMailbox: null,
    overlayVisible: false,
    googleVignetteVisible: false,
    usernameInputVisible: false,
    domainControlVisible: false,
    addInboxButtonVisible: false,
    ...overrides
  }
}

function message(overrides: Partial<InboxesMessageSummary> = {}): InboxesMessageSummary {
  return {
    key: 'mail-live-1',
    sender: 'account-security-noreply@accountprotection.microsoft.com',
    subject: 'Microsoft account security code',
    preview: 'Microsoft account Security code 481726 A few seconds ago',
    receivedLabel: 'A few seconds ago',
    receivedAt: 1_000_000,
    ...overrides
  }
}

describe('Inboxes live provider regressions', () => {
  it('treats an already-open empty expected mailbox as ready instead of Home/Add Inbox', () => {
    expect(classifyInboxesBackgroundSurface(snapshot({
      bodyText: 'Waiting for incoming messages for owner@getnada.com',
      activeMailbox: 'owner@getnada.com'
    }))).toBe('mailbox_ready_expected')
  })

  it('keeps an already-open empty other mailbox distinct from the expected mailbox', () => {
    expect(classifyInboxesBackgroundSurface(snapshot({
      bodyText: 'Waiting for incoming messages for other@getnada.com',
      activeMailbox: 'other@getnada.com'
    }))).toBe('mailbox_ready_other')
  })

  it('uses the visible Add Inbox form immediately instead of waiting for absent mailbox text', () => {
    expect(shouldUseInboxesAddInboxFastPath({
      url: 'https://inboxes.com/',
      vignetteReloads: 0,
      usernameInputVisible: true,
      domainControlVisible: true,
      addInboxButtonVisible: true
    })).toBe(true)

    // A fresh vignette still gets one recovery pass instead of filling through it.
    expect(shouldUseInboxesAddInboxFastPath({
      url: 'https://inboxes.com/#google_vignette',
      vignetteReloads: 0,
      usernameInputVisible: true,
      domainControlVisible: true,
      addInboxButtonVisible: true
    })).toBe(false)

    // Chrome can keep the hash after F5. Once recovered, visible business UI wins.
    expect(shouldUseInboxesAddInboxFastPath({
      url: 'https://inboxes.com/#google_vignette',
      vignetteReloads: 1,
      usernameInputVisible: true,
      domainControlVisible: true,
      addInboxButtonVisible: true
    })).toBe(true)
  })

  it('takes a Microsoft code directly from the fresh list-row preview when the code is already visible', () => {
    const rowSnapshot = inboxesPreviewSnapshot(message(), 1_000_000)
    expect(rowSnapshot).not.toBeNull()
    expect(parseVerificationCode(rowSnapshot ? [rowSnapshot] : [], 1_000_000)?.code).toBe('481726')
  })

  it('does not skip message detail when the row only says Security code but does not expose the code value', () => {
    expect(inboxesPreviewSnapshot(message({ preview: 'Microsoft account Security code A few seconds ago' }), 1_000_000)).toBeNull()
  })

  it('does not let a stale #google_vignette hash block normal provider UI after F5', () => {
    expect(shouldTreatInboxesVignetteAsBlocking({
      url: 'https://inboxes.com/#google_vignette',
      hasCloseControl: false,
      hasBusinessUi: true
    })).toBe(false)
  })

  it('still treats a real vignette surface as blocking when provider UI is unavailable', () => {
    expect(shouldTreatInboxesVignetteAsBlocking({
      url: 'https://inboxes.com/#google_vignette',
      hasCloseControl: false,
      hasBusinessUi: false
    })).toBe(true)
    expect(shouldTreatInboxesVignetteAsBlocking({
      url: 'https://inboxes.com/#google_vignette',
      hasCloseControl: true,
      hasBusinessUi: true
    })).toBe(true)
  })

  it('requires real detail evidence before treating a clicked message as opened mail', () => {
    expect(inboxesBodyHasMessageDetail('From Microsoft account Security code Received')).toBe(false)
    expect(inboxesBodyHasMessageDetail('Microsoft account Security code Use this code to continue: 481726')).toBe(true)
    expect(inboxesBodyHasMessageDetail('Verification code Your code is 654321')).toBe(true)
  })
})
