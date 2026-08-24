import { describe, expect, it } from 'vitest'
import { detectRecoveryMailProvider, getEmailDomain } from './emailRecoveryProviders'

describe('email recovery provider catalog', () => {
  it('normalizes domains and detects known providers', () => {
    expect(getEmailDomain(' Demo@FviaDropInbox.com ')).toBe('fviadropinbox.com')
    expect(detectRecoveryMailProvider('demo@fviamail.work')).toMatchObject({ id: 'fviainboxes', kind: 'temporary' })
    expect(detectRecoveryMailProvider('demo@getnada.com')).toMatchObject({ id: 'inboxes', kind: 'temporary' })
    expect(detectRecoveryMailProvider('demo@outlook.com')).toMatchObject({ id: 'microsoft', kind: 'standard' })
  })

  it('keeps unknown domains usable', () => {
    expect(detectRecoveryMailProvider('demo@example.org')).toEqual({
      id: 'unknown', label: 'Khác / chưa biết', kind: 'unknown', domain: 'example.org'
    })
  })
})
