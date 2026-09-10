import { describe, expect, it } from 'vitest'
import {
  createInboxesStableFallbackMessageKey,
  parseInboxesVisibleCodeRow
} from './inboxesVisibleCodeFallbackDriver'

describe('Inboxes visible-code row fallback', () => {
  it('accepts a Microsoft security code that is already visible even when structured cells are unavailable', () => {
    const now = 1_000_000
    const evidence = parseInboxesVisibleCodeRow(
      'Microsoft account team\nMicrosoft account security code 481726\nA few seconds ago',
      now
    )

    expect(evidence).toMatchObject({
      receivedLabel: 'A few seconds ago',
      receivedAt: now - 5_000,
      code: '481726'
    })
  })

  it('keeps fallback identity stable when only the relative Received label changes', () => {
    const first = createInboxesStableFallbackMessageKey(
      'Microsoft account team',
      'Microsoft account security code',
      'Microsoft account team Microsoft account security code 481726 0 secs ago',
      '0 secs ago'
    )
    const later = createInboxesStableFallbackMessageKey(
      'Microsoft account team',
      'Microsoft account security code',
      'Microsoft account team Microsoft account security code 481726 5 secs ago',
      '5 secs ago'
    )
    const nextCode = createInboxesStableFallbackMessageKey(
      'Microsoft account team',
      'Microsoft account security code',
      'Microsoft account team Microsoft account security code 912345 0 secs ago',
      '0 secs ago'
    )

    expect(later).toBe(first)
    expect(nextCode).not.toBe(first)
    expect(first).not.toContain('481726')
    expect(nextCode).not.toContain('912345')
  })

  it('rejects a numeric row without a verification signal', () => {
    expect(parseInboxesVisibleCodeRow(
      'Shop receipt Order 481726 A few seconds ago',
      1_000_000
    )).toBeNull()
  })

  it('rejects a security-code row without a trustworthy Received label', () => {
    expect(parseInboxesVisibleCodeRow(
      'Microsoft account team Microsoft account security code 481726',
      1_000_000
    )).toBeNull()
  })
})
