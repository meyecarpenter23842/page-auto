import { describe, expect, it } from 'vitest'
import { microsoftRecoveryMailboxEvidence } from './microsoftRecoveryEmailAction'

describe('microsoftRecoveryEmailAction', () => {
  it('accepts exact recovery mailbox evidence', () => {
    expect(microsoftRecoveryMailboxEvidence(
      'Ways to prove who you are adagasilknurpb2401@fivermail.com',
      'adagasilknurpb2401@fivermail.com'
    )).toBe(true)
  })

  it('accepts a masked mailbox only when it does not collide with the old canonical mailbox', () => {
    expect(microsoftRecoveryMailboxEvidence(
      'Email ad*****@fivermail.com',
      'adagasilknurpb2401@fivermail.com',
      'oldmail@getnada.com'
    )).toBe(true)

    expect(microsoftRecoveryMailboxEvidence(
      'Email ad*****@fivermail.com',
      'adagasilknurpb2401@fivermail.com',
      'adagasilknurpOLD@fivermail.com'
    )).toBe(false)
  })

  it('rejects unrelated masked recovery mailboxes', () => {
    expect(microsoftRecoveryMailboxEvidence(
      'Email xx*****@fivermail.com',
      'adagasilknurpb2401@fivermail.com'
    )).toBe(false)
  })
})
