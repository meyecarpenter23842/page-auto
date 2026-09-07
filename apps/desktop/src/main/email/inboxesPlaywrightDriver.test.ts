import { describe, expect, it } from 'vitest'
import { classifyInboxesSurface } from './inboxesPlaywrightDriver'

describe('classifyInboxesSurface', () => {
  it('recognizes the Add Inbox dialog observed in the live flow', () => {
    expect(classifyInboxesSurface({
      bodyText: "Don't give them your private email, use our inboxes",
      expectedMailbox: 'owner@fivermail.com',
      usernameInputVisible: true,
      domainControlVisible: true,
      addInboxButtonVisible: true
    })).toBe('add_inbox_dialog')
  })

  it('requires the exact requested mailbox on a ready inbox surface', () => {
    const table = 'From Subject - Preview Received'
    expect(classifyInboxesSurface({
      bodyText: `owner@getnada.com ${table}`,
      expectedMailbox: 'owner@getnada.com',
      usernameInputVisible: false,
      domainControlVisible: false,
      addInboxButtonVisible: false
    })).toBe('mailbox_ready')
    expect(classifyInboxesSurface({
      bodyText: `other@getnada.com ${table}`,
      expectedMailbox: 'owner@getnada.com',
      usernameInputVisible: false,
      domainControlVisible: false,
      addInboxButtonVisible: false
    })).toBe('mailbox_other')
  })

  it('reclassifies a message detail independently instead of assuming a linear next step', () => {
    expect(classifyInboxesSurface({
      bodyText: 'Microsoft account Security code Use this code to continue',
      expectedMailbox: 'owner@fivermail.com',
      usernameInputVisible: false,
      domainControlVisible: false,
      addInboxButtonVisible: false
    })).toBe('message_detail')
  })
})
