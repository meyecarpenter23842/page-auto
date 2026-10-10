import { describe, expect, it } from 'vitest'
import type { HotmailDashboardRow } from '../../../shared/hotmail'
import {
  EMAIL_CATEGORY_ALL,
  EMAIL_CATEGORY_UNGROUPED,
  filterHotmailRows,
  listHotmailCategoryOptions,
  previewClientId
} from './hotmailUiModel'

function row(patch: Partial<HotmailDashboardRow>): HotmailDashboardRow {
  return {
    accountId: 1,
    uid: '10001',
    accountName: 'Demo Account',
    accountCategory: 'Nhóm A',
    facebookStatus: 'valid',
    accountNote: null,
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
    row({ accountId: 1, uid: '10001', accountName: 'Nguyễn A', accountCategory: 'Ads', oauthStatus: 'valid', hasRefreshToken: true, mailStatus: 'ready' }),
    row({ accountId: 2, uid: '10002', accountName: 'Nguyễn B', accountCategory: 'Seeding', email: 'needs@outlook.com', oauthStatus: 'expired', hasRefreshToken: true, mailStatus: 'needs_login', lastError: 'OAuth expired' }),
    row({ accountId: 3, uid: '10003', accountName: 'Nguyễn C', accountCategory: null, accountNote: 'mail phụ', backupEmail: 'backup@example.com' }),
    row({ accountId: 4, uid: '10004', accountName: 'Nguyễn D', accountCategory: ' Ads ', oauthStatus: 'missing', mailStatus: 'unknown' })
  ]

  it('keeps one canonical row list and filters it by operational Email state', () => {
    expect(filterHotmailRows(rows, '', 'ready').map((item) => item.accountId)).toEqual([1])
    expect(filterHotmailRows(rows, '', 'needs_attention').map((item) => item.accountId)).toEqual([2])
    expect(filterHotmailRows(rows, '', 'recovery').map((item) => item.accountId)).toEqual([3])
  })

  it('searches canonical Account identity together with Email fields', () => {
    expect(filterHotmailRows(rows, 'nguyễn b', 'all').map((item) => item.accountId)).toEqual([2])
    expect(filterHotmailRows(rows, 'seeding', 'all').map((item) => item.accountId)).toEqual([2])
    expect(filterHotmailRows(rows, 'mail phụ', 'all').map((item) => item.accountId)).toEqual([3])
    expect(filterHotmailRows(rows, 'valid', 'all').map((item) => item.accountId)).toEqual([1, 2, 3, 4])
    expect(filterHotmailRows(rows, 'needs@', 'all').map((item) => item.accountId)).toEqual([2])
    expect(filterHotmailRows(rows, 'backup@example', 'all').map((item) => item.accountId)).toEqual([3])
    expect(filterHotmailRows(rows, 'oauth expired', 'all').map((item) => item.accountId)).toEqual([2])
  })

  it('filters Email rows by canonical Account group without creating a second group source', () => {
    expect(filterHotmailRows(rows, '', 'all', 'Ads').map((item) => item.accountId)).toEqual([1, 4])
    expect(filterHotmailRows(rows, '', 'all', 'Seeding').map((item) => item.accountId)).toEqual([2])
    expect(filterHotmailRows(rows, '', 'all', EMAIL_CATEGORY_UNGROUPED).map((item) => item.accountId)).toEqual([3])
    expect(filterHotmailRows(rows, '', 'all', EMAIL_CATEGORY_ALL).map((item) => item.accountId)).toEqual([1, 2, 3, 4])
  })

  it('combines group, Email-state and text filters', () => {
    expect(filterHotmailRows(rows, 'nguyễn a', 'ready', 'Ads').map((item) => item.accountId)).toEqual([1])
    expect(filterHotmailRows(rows, 'nguyễn d', 'ready', 'Ads')).toEqual([])
    expect(filterHotmailRows(rows, 'oauth expired', 'needs_attention', 'Seeding').map((item) => item.accountId)).toEqual([2])
  })
})

describe('listHotmailCategoryOptions', () => {
  it('builds canonical Account group options with counts and one ungrouped bucket', () => {
    const rows = [
      row({ accountId: 1, accountCategory: 'Ads' }),
      row({ accountId: 2, accountCategory: 'Seeding' }),
      row({ accountId: 3, accountCategory: null }),
      row({ accountId: 4, accountCategory: ' Ads ' }),
      row({ accountId: 5, accountCategory: '  ' })
    ]

    expect(listHotmailCategoryOptions(rows)).toEqual([
      { value: EMAIL_CATEGORY_UNGROUPED, label: 'Chưa gán nhóm', count: 2 },
      { value: 'Ads', label: 'Ads', count: 2 },
      { value: 'Seeding', label: 'Seeding', count: 1 }
    ])
  })
})

describe('previewClientId', () => {
  it('keeps short IDs and abbreviates long IDs for dense grid display', () => {
    expect(previewClientId(null)).toBe('—')
    expect(previewClientId('short-id')).toBe('short-id')
    expect(previewClientId('12345678-abcdefghijkl')).toBe('12345678…ijkl')
  })
})
