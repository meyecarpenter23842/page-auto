import { describe, expect, it } from 'vitest'
import {
  INBOXES_DOMAINS,
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

  it('prioritizes the two live target domains without giving them separate modules', () => {
    expect(isKnownInboxesMailbox('A@FIVERMAIL.COM')).toBe(true)
    expect(isKnownInboxesMailbox('b@getnada.com')).toBe(true)
    expect(resolveMailProviderId('A@FIVERMAIL.COM')).toBe(resolveMailProviderId('b@getnada.com'))
  })

  it('keeps Microsoft domains separate from Inboxes and does not guess unknown domains', () => {
    expect(resolveMailProviderId('owner@hotmail.com')).toBe('microsoft')
    expect(resolveMailProviderId('owner@outlook.com')).toBe('microsoft')
    expect(resolveMailProviderId('owner@custom.example')).toBeNull()
    expect(resolveMailProviderId('not-an-email')).toBeNull()
    expect(mailDomainFromAddress(' Owner@GetNada.Com ')).toBe('getnada.com')
  })
})
