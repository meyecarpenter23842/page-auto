import { describe, expect, it } from 'vitest'
import {
  classifyInboxesBackgroundSurface,
  inboxesBodyHasMessageDetail,
  type InboxesBackgroundSurfaceSnapshot
} from './inboxesBackgroundPlaywrightDriver'
import { shouldTreatInboxesVignetteAsBlocking } from './inboxesVignetteGuard'

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
