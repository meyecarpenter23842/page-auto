import { describe, expect, it } from 'vitest'
import { resolvePrimaryMailboxOpenRoute } from './primaryMailboxOpenPolicy'

describe('primary mailbox open routing', () => {
  it('keeps Microsoft primary mail on the existing Microsoft browser flow', () => {
    expect(resolvePrimaryMailboxOpenRoute('owner@outlook.com')).toEqual({
      kind: 'microsoft',
      providerId: 'microsoft'
    })
  })

  it('routes FiverMail primary addresses through Inboxes instead of Outlook', () => {
    expect(resolvePrimaryMailboxOpenRoute('owner@fivermail.com')).toEqual({
      kind: 'browser_provider',
      providerId: 'inboxes'
    })
  })

  it('routes Fvia primary addresses through FviaInboxes instead of Outlook', () => {
    expect(resolvePrimaryMailboxOpenRoute('owner@fviainboxes.com')).toEqual({
      kind: 'browser_provider',
      providerId: 'fvia_inboxes'
    })
  })

  it('fails closed for a primary provider without an audited manual-open surface', () => {
    expect(resolvePrimaryMailboxOpenRoute('owner@example.org')).toEqual({
      kind: 'unsupported',
      providerId: null
    })
  })
})
