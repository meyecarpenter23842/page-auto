import { describe, expect, it } from 'vitest'
import type { ScanResultRecord } from '../../../shared/scanner'
import { eligibleGroupResultIds, groupResultMatchesSelectionFilters } from './scannerGroupSelection'

function result(
  id: number,
  data: ScanResultRecord['data'],
  status: ScanResultRecord['status'] = 'success'
): ScanResultRecord {
  return {
    id,
    jobId: 1,
    scanType: 'group',
    entityId: String(1000 + id),
    displayName: `Group ${id}`,
    url: null,
    status,
    data,
    scannedAt: 1
  }
}

describe('scanner group auto-selection', () => {
  it('matches members, privacy and location from loaded Facebook metadata text', () => {
    const item = result(1, {
      members: 58_000,
      privacy: 'Public',
      location: null,
      filterText: 'Nguyên liệu trà sữa · Public · 58K members · Hồ Chí Minh'
    })
    expect(groupResultMatchesSelectionFilters(item, {
      membersMin: 20_000,
      membersMax: 100_000,
      privacy: 'public',
      location: 'ho chi minh'
    })).toBe(true)
  })

  it('does not auto-select errors or rows missing metadata required by the active filter', () => {
    const rows = [
      result(1, { members: 30_000, privacy: 'Public', filterText: 'Hà Nội' }),
      result(2, { members: null, privacy: 'Public', filterText: 'Hà Nội' }, 'partial_success'),
      result(3, { members: 60_000, privacy: 'Private', filterText: 'Hà Nội' }),
      result(4, { members: 80_000, privacy: 'Public', filterText: 'Hà Nội' }, 'permission_limited')
    ]
    expect(eligibleGroupResultIds(rows, {
      membersMin: 20_000,
      membersMax: 70_000,
      privacy: 'public',
      location: 'ha noi'
    })).toEqual([1])
  })

  it('treats zero min/max and all privacy as no restriction', () => {
    const rows = [
      result(1, { members: null, privacy: null, filterText: '' }, 'partial_success'),
      result(2, { members: 5_000, privacy: 'Private', filterText: '' })
    ]
    expect(eligibleGroupResultIds(rows, {
      membersMin: 0,
      membersMax: 0,
      privacy: 'all',
      location: ''
    })).toEqual([1, 2])
  })
})
