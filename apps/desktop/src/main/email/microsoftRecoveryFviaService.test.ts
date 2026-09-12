import { describe, expect, it } from 'vitest'
import { createMicrosoftRecoveryRound } from './microsoftRecoveryChallenge'

describe('Microsoft recovery provider-neutral round identity', () => {
  it('keeps Fvia baseline and durable consumed message identity without routing on provider behavior', () => {
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

  it('allows a provisional round to exist before the Mailbox Router resolves its provider', () => {
    const round = createMicrosoftRecoveryRound(
      'owner@mailto.plus',
      null,
      null,
      [],
      ['submitted-earlier']
    )

    expect(round.providerId).toBeNull()
    expect(round.requestedAt).toBeNull()
    expect(round.consumedMessageKeys).toEqual(['submitted-earlier'])
  })
})
