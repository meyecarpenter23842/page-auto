import { describe, expect, it } from 'vitest'
import {
  classifyInboxesSurface,
  parseInboxesMessageRowCells,
  parseInboxesReceivedAtLabel
} from './inboxesPlaywrightDriver'

describe('classifyInboxesSurface', () => {
  it('recognizes the Add Inbox dialog observed in the live flow', () => {
    expect(classifyInboxesSurface({
      bodyText: "Don't give them your private email, use our inboxes",
      expectedMailbox: 'owner@fivermail.com',
      activeMailbox: null,
      usernameInputVisible: true,
      domainControlVisible: true,
      addInboxButtonVisible: true
    })).toBe('add_inbox_dialog')
  })

  it('requires the active hero mailbox, not a matching address elsewhere on the page', () => {
    const table = 'From Subject - Preview Received'
    expect(classifyInboxesSurface({
      bodyText: `owner@getnada.com ${table}`,
      expectedMailbox: 'owner@getnada.com',
      activeMailbox: 'owner@getnada.com',
      usernameInputVisible: false,
      domainControlVisible: false,
      addInboxButtonVisible: false
    })).toBe('mailbox_ready')

    expect(classifyInboxesSurface({
      bodyText: `owner@getnada.com other@getnada.com ${table}`,
      expectedMailbox: 'owner@getnada.com',
      activeMailbox: 'other@getnada.com',
      usernameInputVisible: false,
      domainControlVisible: false,
      addInboxButtonVisible: false
    })).toBe('mailbox_other')
  })

  it('reclassifies a message detail independently instead of assuming a linear next step', () => {
    expect(classifyInboxesSurface({
      bodyText: 'Microsoft account Security code Use this code to continue',
      expectedMailbox: 'owner@fivermail.com',
      activeMailbox: null,
      usernameInputVisible: false,
      domainControlVisible: false,
      addInboxButtonVisible: false
    })).toBe('message_detail')
  })
})

describe('parseInboxesReceivedAtLabel', () => {
  it('preserves the relative Received age shown by the live Inboxes table', () => {
    const now = 10_000_000
    expect(parseInboxesReceivedAtLabel('1 secs ago', now)).toBe(now - 1_000)
    expect(parseInboxesReceivedAtLabel('39 seconds ago', now)).toBe(now - 39_000)
    expect(parseInboxesReceivedAtLabel('5 minutes ago', now)).toBe(now - 5 * 60_000)
    expect(parseInboxesReceivedAtLabel('4 hour ago', now)).toBe(now - 4 * 60 * 60_000)
  })

  it('fails closed when the Received label cannot be parsed', () => {
    expect(parseInboxesReceivedAtLabel('sometime earlier', 10_000_000)).toBeNull()
  })
})

describe('parseInboxesMessageRowCells', () => {
  it('parses the live Inboxes row with checkbox and star columns before From', () => {
    const now = 10_000_000
    expect(parseInboxesMessageRowCells([
      '',
      '',
      'Microsoft account team',
      'Your single-use code',
      '0 secs ago'
    ], now)).toEqual({
      sender: 'Microsoft account team',
      subject: 'Your single-use code',
      receivedLabel: '0 secs ago',
      receivedAt: now
    })
  })

  it('ignores extra leading control text and anchors fields from the Received column', () => {
    const now = 10_000_000
    expect(parseInboxesMessageRowCells([
      'Select',
      'Star',
      'Microsoft account team',
      'Your single-use code',
      '1 secs ago'
    ], now)).toEqual({
      sender: 'Microsoft account team',
      subject: 'Your single-use code',
      receivedLabel: '1 secs ago',
      receivedAt: now - 1_000
    })
  })

  it('fails closed when no Received cell can be identified', () => {
    expect(parseInboxesMessageRowCells([
      '',
      '',
      'Microsoft account team',
      'Your single-use code',
      'unknown age'
    ], 10_000_000)).toBeNull()
  })
})
