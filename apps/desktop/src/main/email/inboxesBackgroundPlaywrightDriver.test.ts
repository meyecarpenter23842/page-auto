import { describe, expect, it } from 'vitest'
import {
  classifyInboxesBackgroundSurface,
  isInboxesProviderPageUrl,
  type InboxesBackgroundSurfaceSnapshot
} from './inboxesBackgroundPlaywrightDriver'

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

describe('classifyInboxesBackgroundSurface', () => {
  it('classifies closed/unavailable/overlay states before normal mailbox actions', () => {
    expect(classifyInboxesBackgroundSurface(snapshot({ pageClosed: true }))).toBe('provider_closed')
    expect(classifyInboxesBackgroundSurface(snapshot({ bodyText: '502 Bad Gateway' }))).toBe('provider_unavailable')
    expect(classifyInboxesBackgroundSurface(snapshot({ overlayVisible: true }))).toBe('overlay_blocking')
  })

  it('distinguishes expected mailbox, other mailbox, and an unbound message list', () => {
    const table = 'From Subject - Preview Received'
    expect(classifyInboxesBackgroundSurface(snapshot({
      bodyText: table,
      activeMailbox: 'owner@getnada.com'
    }))).toBe('mailbox_ready_expected')

    expect(classifyInboxesBackgroundSurface(snapshot({
      bodyText: table,
      activeMailbox: 'other@getnada.com'
    }))).toBe('mailbox_ready_other')

    expect(classifyInboxesBackgroundSurface(snapshot({ bodyText: table }))).toBe('message_list')
  })

  it('binds message detail to the last verified mailbox instead of guessing from tab order', () => {
    const detail = 'Microsoft account Security code Use this code to continue'
    expect(classifyInboxesBackgroundSurface(snapshot({
      bodyText: detail,
      lastKnownMailbox: 'owner@getnada.com'
    }))).toBe('message_detail_expected')

    expect(classifyInboxesBackgroundSurface(snapshot({
      bodyText: detail,
      lastKnownMailbox: 'other@getnada.com'
    }))).toBe('message_detail_other')
  })

  it('recognizes the Add Inbox form independently', () => {
    expect(classifyInboxesBackgroundSurface(snapshot({
      usernameInputVisible: true,
      domainControlVisible: true,
      addInboxButtonVisible: true
    }))).toBe('add_inbox_dialog')
  })

  it('does not dismiss a legitimate Add Inbox modal as a generic blocking overlay', () => {
    expect(classifyInboxesBackgroundSurface(snapshot({
      overlayVisible: true,
      usernameInputVisible: true,
      domainControlVisible: true,
      addInboxButtonVisible: true
    }))).toBe('add_inbox_dialog')
  })

  it('treats a Google vignette as blocking even when the Add Inbox form stays visible behind it', () => {
    expect(classifyInboxesBackgroundSurface(snapshot({
      overlayVisible: true,
      googleVignetteVisible: true,
      usernameInputVisible: true,
      domainControlVisible: true,
      addInboxButtonVisible: true
    }))).toBe('overlay_blocking')
  })
})

describe('isInboxesProviderPageUrl', () => {
  it('accepts only the Inboxes provider host family', () => {
    expect(isInboxesProviderPageUrl('https://inboxes.com/')).toBe(true)
    expect(isInboxesProviderPageUrl('https://www.inboxes.com/mail/123')).toBe(true)
    expect(isInboxesProviderPageUrl('https://login.live.com/')).toBe(false)
    expect(isInboxesProviderPageUrl('https://fviainboxes.com/')).toBe(false)
    expect(isInboxesProviderPageUrl('about:blank')).toBe(false)
  })
})
