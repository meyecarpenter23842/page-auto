import { describe, expect, it } from 'vitest'
import {
  classifyFviaInboxesSurface,
  fviaDomainControlReadMode,
  fviaVerificationDetailReady,
  isFviaDomainControlValue,
  parseFviaReceivedAtLabel
} from './fviaInboxesPlaywrightDriver'

describe('classifyFviaInboxesSurface', () => {
  it('recognizes the audited username/domain/Get Email form before a mailbox is activated', () => {
    expect(classifyFviaInboxesSurface({
      bodyText: 'FREE Temporary Email Inbox No emails yet',
      expectedMailbox: 'owner@fviainboxes.com',
      activatedMailbox: null,
      usernameValue: '',
      selectedDomain: 'fviainboxes.com',
      usernameInputVisible: true,
      domainControlVisible: true,
      getEmailButtonVisible: true,
      inboxVisible: true
    })).toBe('mailbox_form')
  })

  it('treats the blank live Fvia shell as loading while the mailbox form hydrates', () => {
    expect(classifyFviaInboxesSurface({
      bodyText: '',
      expectedMailbox: 'owner@fviadropinbox.com',
      activatedMailbox: null,
      usernameValue: '',
      selectedDomain: null,
      usernameInputVisible: false,
      domainControlVisible: false,
      getEmailButtonVisible: false,
      inboxVisible: false
    })).toBe('loading')

    expect(classifyFviaInboxesSurface({
      bodyText: 'FREE Temporary Email Inbox',
      expectedMailbox: 'owner@fviadropinbox.com',
      activatedMailbox: null,
      usernameValue: '',
      selectedDomain: null,
      usernameInputVisible: false,
      domainControlVisible: false,
      getEmailButtonVisible: false,
      inboxVisible: true
    })).toBe('loading')
  })

  it('requires the exact activated local part and domain before treating the inbox as ready', () => {
    expect(classifyFviaInboxesSurface({
      bodyText: 'Inbox Emails will appear here automatically',
      expectedMailbox: 'owner@fviadropinbox.com',
      activatedMailbox: 'owner@fviadropinbox.com',
      usernameValue: 'owner',
      selectedDomain: 'fviadropinbox.com',
      usernameInputVisible: true,
      domainControlVisible: true,
      getEmailButtonVisible: true,
      inboxVisible: true
    })).toBe('mailbox_ready')

    expect(classifyFviaInboxesSurface({
      bodyText: 'Inbox Emails will appear here automatically',
      expectedMailbox: 'owner@fviadropinbox.com',
      activatedMailbox: 'other@fviadropinbox.com',
      usernameValue: 'other',
      selectedDomain: 'fviadropinbox.com',
      usernameInputVisible: true,
      domainControlVisible: true,
      getEmailButtonVisible: true,
      inboxVisible: true
    })).toBe('mailbox_form')
  })

  it('fails closed when Fvia explicitly reports a provider failure', () => {
    expect(classifyFviaInboxesSurface({
      bodyText: 'Service unavailable',
      expectedMailbox: 'owner@dropinboxes.com',
      activatedMailbox: null,
      usernameValue: '',
      selectedDomain: null,
      usernameInputVisible: false,
      domainControlVisible: false,
      getEmailButtonVisible: false,
      inboxVisible: false
    })).toBe('provider_unavailable')
  })
})

describe('isFviaDomainControlValue', () => {
  it('recognizes the live Fvia domain values exposed by the custom listbox trigger', () => {
    for (const domain of [
      'fviainboxes.com',
      'fviadropinbox.com',
      'fviamail.work',
      'dropinboxes.com',
      'titanads.email'
    ]) {
      expect(isFviaDomainControlValue(domain)).toBe(true)
    }

    expect(isFviaDomainControlValue('@fviadropinbox.com')).toBe(true)
    expect(isFviaDomainControlValue('gmail.com')).toBe(false)
    expect(isFviaDomainControlValue('')).toBe(false)
  })
})

describe('fviaDomainControlReadMode', () => {
  it('never treats custom button/div listbox triggers as native selects', () => {
    expect(fviaDomainControlReadMode('select')).toBe('select')
    expect(fviaDomainControlReadMode('input')).toBe('value')
    expect(fviaDomainControlReadMode('textarea')).toBe('value')
    expect(fviaDomainControlReadMode('button')).toBe('text')
    expect(fviaDomainControlReadMode('div')).toBe('text')
  })
})

describe('fviaVerificationDetailReady', () => {
  it('accepts the live detail once a labelled numeric verification code renders even when row text is truncated', () => {
    const before = 'Inbox account-security-noreply just now Personal Microsoft account securit...'
    const detail = 'Personal Microsoft account security code noreply@accountprotection.microsoft.com Security code: 654321 Thanks'

    expect(detail.toLowerCase().includes(before.toLowerCase())).toBe(false)
    expect(fviaVerificationDetailReady(before, detail)).toBe(true)
  })

  it('does not treat sender text after security-code wording as the code itself', () => {
    const before = 'Inbox Microsoft account security code just now'
    const senderOnly = 'Personal Microsoft account security code noreply@accountprotection.microsoft.com'

    expect(fviaVerificationDetailReady(before, senderOnly)).toBe(false)
  })

  it('does not treat inbox-list text or unrelated page changes as message detail', () => {
    const before = 'Inbox Personal Microsoft account security code just now'
    expect(fviaVerificationDetailReady(before, before)).toBe(false)
    expect(fviaVerificationDetailReady(before, `${before} Sponsored content changed`)).toBe(false)
  })
})

describe('parseFviaReceivedAtLabel', () => {
  it('uses a visible relative time when Fvia exposes one', () => {
    const now = 10_000_000
    expect(parseFviaReceivedAtLabel('2 minutes ago', now)).toBe(now - 120_000)
    expect(parseFviaReceivedAtLabel('just now', now)).toBe(now)
  })

  it('returns null when the Fvia list has no trustworthy time label', () => {
    expect(parseFviaReceivedAtLabel('', 10_000_000)).toBeNull()
    expect(parseFviaReceivedAtLabel('Microsoft account security code', 10_000_000)).toBeNull()
  })
})
