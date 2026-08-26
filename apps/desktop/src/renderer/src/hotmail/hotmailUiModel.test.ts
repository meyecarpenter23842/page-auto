import { describe, expect, it } from 'vitest'
import type { HotmailDashboardRow } from '../../../shared/hotmail'
import { filterHotmailRows, previewClientId } from './hotmailUiModel'

function row(patch: Partial<HotmailDashboardRow>): HotmailDashboardRow {
  return {
    accountId: 1,
    uid: '10001',
    email: 'demo@outlook.com',
    emailPasswordMasked: '••••••',
    backupEmail: null,
    oauthStatus: 'missing',
    oauthClientId: null,
    hasRefreshToken: false,
    oauthUpdatedAt: null,
    lastTokenCheckAt: null,
    mailStatus: 'unknown',
    profileStatus: 'not_configured',
    profileDirectory: null,
    latestCode: null,
    lastCodeAt: null,
    lastCheckAt: null,
    runtimeStatus: 'idle',
    lastError: null,
    ...patch
  }
}

describe('filterHotmailRows', () => {
  const rows = [
    row({ accountId: 1, uid: '10001', oauthStatus: 'valid', hasRefreshToken: true, mailStatus: 'ready' }),
    row({ accountId: 2, uid: '10002', email: 'needs@outlook.com', oauthStatus: 'expired', hasRefreshToken: true, mailStatus: 'needs_login', lastError: 'OAuth expired' }),
    row({ accountId: 3, uid: '10003', backupEmail: 'backup@example.com' })
  ]

  it('keeps one canonical row list and filters it by operational state', () => {
    expect(filterHotmailRows(rows, '', 'ready').map((item) => item.accountId)).toEqual([1])
    expect(filterHotmailRows(rows, '', 'needs_attention').map((item) => item.accountId)).toEqual([2])
    expect(filterHotmailRows(rows, '', 'recovery').map((item) => item.accountId)).toEqual([3])
  })

  it('searches UID, email, recovery, OAuth metadata, profile path and error text', () => {
    expect(filterHotmailRows(rows, 'needs@', 'all').map((item) => item.accountId)).toEqual([2])
    expect(filterHotmailRows(rows, 'backup@example', 'all').map((item) => item.accountId)).toEqual([3])
    expect(filterHotmailRows(rows, 'oauth expired', 'all').map((item) => item.accountId)).toEqual([2])
  })
})

describe('previewClientId', () => {
  it('keeps short IDs and abbreviates long IDs for dense grid display', () => {
    expect(previewClientId(null)).toBe('—')
    expect(previewClientId('short-id')).toBe('short-id')
    expect(previewClientId('12345678-abcdefghijkl')).toBe('12345678…ijkl')
  })
})
