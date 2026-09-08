import { describe, expect, it } from 'vitest'
import {
  EMAIL_AUTH_V2_HANDLER_RESULT_KINDS,
  EMAIL_AUTH_V2_REQUIRED_HANDLER_KEYS,
  EMAIL_AUTH_V2_RESULT_SEMANTICS,
  EMAIL_AUTH_V2_SURFACES,
  EMAIL_PAGE_ROLES,
  MAILBOX_CODE_SURFACES,
  type EmailRecoveryRoundContract
} from './emailAuthV2Contracts'

describe('Email Auth V2 Batch 0 contracts', () => {
  it('locks every required Microsoft handler surface as an explicit state', () => {
    for (const handlerKey of EMAIL_AUTH_V2_REQUIRED_HANDLER_KEYS) {
      expect(EMAIL_AUTH_V2_SURFACES).toContain(handlerKey)
    }
    expect(new Set(EMAIL_AUTH_V2_SURFACES).size).toBe(EMAIL_AUTH_V2_SURFACES.length)
  })

  it('requires non-terminal handler outcomes to return to detection instead of assuming the next step', () => {
    expect(EMAIL_AUTH_V2_RESULT_SEMANTICS.handled).toEqual({ terminal: false, mustDetectAgain: true })
    expect(EMAIL_AUTH_V2_RESULT_SEMANTICS.retryable).toEqual({ terminal: false, mustDetectAgain: true })
    expect(EMAIL_AUTH_V2_RESULT_SEMANTICS.needs_attention).toEqual({ terminal: true, mustDetectAgain: false })
    expect(EMAIL_AUTH_V2_RESULT_SEMANTICS.authenticated).toEqual({ terminal: true, mustDetectAgain: false })
    expect(new Set(EMAIL_AUTH_V2_HANDLER_RESULT_KINDS).size).toBe(EMAIL_AUTH_V2_HANDLER_RESULT_KINDS.length)
  })

  it('locks page ownership roles so page index can never be the V2 identity contract', () => {
    expect(EMAIL_PAGE_ROLES).toEqual([
      'microsoft_auth',
      'outlook_mail',
      'mailbox_provider',
      'unrelated'
    ])
  })

  it('locks mailbox surfaces required for background recovery and re-entry', () => {
    expect(MAILBOX_CODE_SURFACES).toEqual(expect.arrayContaining([
      'provider_closed',
      'overlay_blocking',
      'mailbox_ready_expected',
      'mailbox_ready_other',
      'message_detail_expected',
      'message_detail_other'
    ]))
  })

  it('keeps recovery-round state limited to metadata and consumed message identity', () => {
    const round: EmailRecoveryRoundContract = {
      challengeId: 'challenge-1',
      mailbox: 'owner@example.com',
      providerId: 'inboxes',
      requestedAt: 1_000_000,
      consumedMessageKeys: ['mail-1'],
      lastSubmittedMessageKey: 'mail-1',
      lastSubmittedCodeFingerprint: 'sha256:deadbeef',
      submitAttempts: 1
    }

    expect(round).not.toHaveProperty('code')
    expect(round).not.toHaveProperty('password')
    expect(round.consumedMessageKeys).toEqual(['mail-1'])
  })
})
