import { describe, expect, it } from 'vitest'
import { parseVerificationCode } from './verificationCodeParser'
import type { InboxesMessageSummary } from './inboxesProvider'
import {
  inboxesDetailMatchesMessage,
  parseInboxesVisibleMessageDetail,
  rebaseInboxesMessageReceivedAt
} from './inboxesVisibleCodeFallbackDriver'

const NOW = 1_000_000

function message(overrides: Partial<InboxesMessageSummary> = {}): InboxesMessageSummary {
  return {
    key: 'mail-live-new',
    sender: 'Microsoft account team',
    subject: 'Personal Microsoft account security code',
    preview: 'Personal Microsoft account security code - Microsoft account Security code Please...',
    receivedLabel: '28 secs ago',
    receivedAt: NOW - 28_000,
    ...overrides
  }
}

describe('Inboxes detail-first and live timestamp regressions', () => {
  it('accepts an already-open code detail only when it belongs to the canonical mailbox', () => {
    const body = [
      "Don't give them your private email, use owner@fivermail.com",
      'Personal Microsoft account security code',
      'From: "Microsoft account team" <account-security-noreply@accountprotection.microsoft.com>',
      'Received: 28 secs ago',
      'Please use the following security code for your personal Microsoft account owner@example.com.',
      'Security code: 481726'
    ].join(' ')

    const detail = parseInboxesVisibleMessageDetail(body, 'owner@fivermail.com', NOW)
    expect(detail).not.toBeNull()
    expect(detail?.summary.receivedAt).toBe(NOW - 28_000)
    expect(parseVerificationCode(detail ? [detail.snapshot] : [], NOW)?.code).toBe('481726')
    expect(parseInboxesVisibleMessageDetail(body, 'other@fivermail.com', NOW)).toBeNull()
  })

  it('does not mistake a list row for an already-open message detail', () => {
    const listBody = [
      "Don't give them your private email, use owner@fivermail.com",
      'FROM SUBJECT - PREVIEW RECEIVED',
      'Microsoft account Personal Microsoft account security code 28 secs ago'
    ].join(' ')

    expect(parseInboxesVisibleMessageDetail(listBody, 'owner@fivermail.com', NOW)).toBeNull()
  })

  it('re-bases relative Received labels at the time the row is actually observed', () => {
    const stale = message({ receivedAt: NOW - 58_000 })
    const observedAt = NOW + 30_000
    const rebased = rebaseInboxesMessageReceivedAt(stale, observedAt)

    expect(rebased.receivedAt).toBe(observedAt - 28_000)
  })

  it('matches the clicked detail to the fresh row and rejects an old security-code detail', () => {
    const freshMessage = message()
    const oneMinuteLater = NOW + 32_000

    expect(inboxesDetailMatchesMessage(
      'Microsoft account Personal Microsoft account security code Received: 1 mins ago Security code: 481726',
      freshMessage,
      oneMinuteLater
    )).toBe(true)

    expect(inboxesDetailMatchesMessage(
      'Microsoft account Personal Microsoft account security code Received: 2 hours ago Security code: 999999',
      freshMessage,
      oneMinuteLater
    )).toBe(false)
  })
})
