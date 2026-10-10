import { describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import type { InboxesMailboxDriver } from './inboxesProvider'
import {
  createInboxesStableFallbackMessageKey,
  createInboxesStableOccurrenceKeys,
  InboxesVisibleCodeFallbackDriver,
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

  it('keeps existing row identities stable when Inboxes prepends a new row with the same DOM base key', () => {
    const shared = 'href:/shared-message-target'
    const other = 'href:/other-target'
    const baseline = createInboxesStableOccurrenceKeys([shared, other, shared])
    const afterNewDelivery = createInboxesStableOccurrenceKeys([shared, shared, other, shared])

    expect(afterNewDelivery.slice(1)).toEqual(baseline)
    expect(afterNewDelivery[0]).not.toBe(baseline[0])
    expect(new Set(afterNewDelivery).size).toBe(afterNewDelivery.length)
  })

  it('does not collapse duplicate provider row ids into the same message identity', () => {
    const keys = createInboxesStableOccurrenceKeys([
      'id:message-row',
      'id:message-row',
      'id:message-row'
    ])

    expect(keys).toEqual([
      'id:message-row:occ:3',
      'id:message-row:occ:2',
      'id:message-row:occ:1'
    ])
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

  it('uses the poll refresh hook only as a provider-page health check', async () => {
    const baseRefresh = vi.fn(async () => undefined)
    const base: InboxesMailboxDriver = {
      ensureMailbox: async (mailbox) => ({ status: 'ready', activeMailbox: mailbox }),
      listMessages: async () => [],
      readMessage: async () => null,
      refreshMailbox: baseRefresh
    }
    const page = {
      isClosed: () => false,
      url: () => 'https://inboxes.com/'
    } as unknown as Page
    const driver = new InboxesVisibleCodeFallbackDriver(page, base)

    await expect(driver.refreshMailbox()).resolves.toBeUndefined()
    expect(baseRefresh).not.toHaveBeenCalled()
  })

  it('fails the poll health check promptly when the owned Inboxes page is lost', async () => {
    const base: InboxesMailboxDriver = {
      ensureMailbox: async (mailbox) => ({ status: 'ready', activeMailbox: mailbox }),
      listMessages: async () => [],
      readMessage: async () => null,
      refreshMailbox: async () => undefined
    }
    const page = {
      isClosed: () => false,
      url: () => 'about:blank'
    } as unknown as Page
    const driver = new InboxesVisibleCodeFallbackDriver(page, base)

    await expect(driver.refreshMailbox()).rejects.toThrow(/left the provider page/i)
  })
})
