import { describe, expect, it } from 'vitest'
import {
  createMicrosoftRecoveryRound,
  microsoftRecoveryRequiresResumeMailboxBaseline,
  microsoftRecoveryUsesMailboxCodeService
} from './microsoftRecoveryChallenge'

describe('Microsoft recovery FviaInboxes service routing', () => {
  it('routes Inboxes and FviaInboxes through MailboxCodeService while leaving MailtoPlus legacy', () => {
    expect(microsoftRecoveryUsesMailboxCodeService('inboxes')).toBe(true)
    expect(microsoftRecoveryUsesMailboxCodeService('fvia_inboxes')).toBe(true)
    expect(microsoftRecoveryUsesMailboxCodeService('mailto_plus')).toBe(false)
  })

  it('keeps timestamp-less Fvia baseline and durable consumed message identity in the recovery round', () => {
    expect(microsoftRecoveryRequiresResumeMailboxBaseline('fvia_inboxes')).toBe(true)

    const round = createMicrosoftRecoveryRound(
      'owner@fviainboxes.com',
      'fvia_inboxes',
      123_000,
      ['before-send'],
      ['submitted-earlier']
    )

    expect(round.providerId).toBe('fvia_inboxes')
    expect(round.requestedAt).toBe(123_000)
    expect(round.baselineMessageKeys).toEqual(['before-send'])
    expect(round.consumedMessageKeys).toEqual(['submitted-earlier'])
  })
})
