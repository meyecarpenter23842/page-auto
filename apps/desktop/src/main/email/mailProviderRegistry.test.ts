import { describe, expect, it } from 'vitest'
import {
  FVIA_INBOXES_DOMAINS,
  INBOXES_DOMAINS,
  MAILTO_PLUS_DOMAINS,
  isKnownFviaInboxesMailbox,
  isKnownInboxesMailbox,
  mailDomainFromAddress,
  mailProviderDomains,
  resolveMailProviderId
} from './mailProviderRegistry'

describe('mailProviderRegistry', () => {
  it('maps every observed Inboxes domain to one inboxes provider', () => {
    for (const domain of INBOXES_DOMAINS) {
      expect(resolveMailProviderId(`owner@${domain}`)).toBe('inboxes')
    }
    expect(mailProviderDomains('inboxes')).toEqual(INBOXES_DOMAINS)
  })

  it('prioritizes the two live Inboxes target domains without giving them separate modules', () => {
    expect(isKnownInboxesMailbox('A@FIVERMAIL.COM')).toBe(true)
    expect(isKnownInboxesMailbox('b@getnada.com')).toBe(true)
    expect(resolveMailProviderId('A@FIVERMAIL.COM')).toBe(resolveMailProviderId('b@getnada.com'))
  })

  it('maps the audited Fvia domain family to one fvia_inboxes provider', () => {
    for (const domain of FVIA_INBOXES_DOMAINS) {
      expect(resolveMailProviderId(`owner@${domain}`)).toBe('fvia_inboxes')
      expect(isKnownFviaInboxesMailbox(`owner@${domain}`)).toBe(true)
    }
    expect(mailProviderDomains('fvia_inboxes')).toEqual(FVIA_INBOXES_DOMAINS)
  })

  it('maps only the audited MailtoPlus production domain in this batch', () => {
    expect(resolveMailProviderId('Owner@MAILTO.PLUS')).toBe('mailto_plus')
    expect(mailProviderDomains('mailto_plus')).toEqual(MAILTO_PLUS_DOMAINS)
    expect(resolveMailProviderId('owner@fexpost.com')).toBeNull()
  })

  it('keeps Microsoft and browser-mail providers separate and does not guess unknown domains', () => {
    expect(resolveMailProviderId('owner@hotmail.com')).toBe('microsoft')
    expect(resolveMailProviderId('owner@outlook.com')).toBe('microsoft')
    expect(resolveMailProviderId('owner@fivermail.com')).toBe('inboxes')
    expect(resolveMailProviderId('owner@fviainboxes.com')).toBe('fvia_inboxes')
    expect(resolveMailProviderId('owner@mailto.plus')).toBe('mailto_plus')
    expect(resolveMailProviderId('owner@custom.example')).toBeNull()
    expect(resolveMailProviderId('not-an-email')).toBeNull()
    expect(mailDomainFromAddress(' Owner@GetNada.Com ')).toBe('getnada.com')
  })
})
