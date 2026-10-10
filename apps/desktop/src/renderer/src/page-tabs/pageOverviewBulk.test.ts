import { describe, expect, it } from 'vitest'
import type { PageTabSummary } from '../../../shared/pageTabs'
import type { RotationRuntimeSnapshot } from '../../../shared/rotation'
import { eligibleForBulkAction, eligibleSelectedPageIds, updatePageCheckedIds } from './pageOverviewBulk'

const page = (id: number): PageTabSummary => ({
  id, pageUid: String(id), name: 'Page ' + id, status: 'idle',
  accountCount: 1, scheduleCount: 1, groupCount: 1, contentCount: 0,
  imageFolder: '', updatedAt: 0
})
const runtime = (status: RotationRuntimeSnapshot['status']) =>
  ({ status } as RotationRuntimeSnapshot)

describe('Issue #521 R2 overview selection and bulk targets', () => {
  it('preserves checked IDs outside filtered/sorted visible rows', () => {
    const checked = new Set([88])
    const selected = updatePageCheckedIds(checked, [3, 1, 2], 1, 'toggle', null, true)
    const range = updatePageCheckedIds(selected, [3, 1, 2], 2, 'range', 3, true)
    expect([...range].sort((a, b) => a - b)).toEqual([1, 2, 3, 88])
    expect(updatePageCheckedIds(range, [2], 2, 'toggle', null, false).has(88)).toBe(true)
    expect(updatePageCheckedIds(range, [3, 1, 2], 99, 'toggle', null)).toEqual(range)
  })

  it('deleting a range never touches hidden selections', () => {
    const selected = updatePageCheckedIds(new Set([1, 2, 3, 999]), [3, 1, 2], 2, 'range', 3, false)
    expect([...selected]).toEqual([999])
  })

  it('filters unavailable runtime actions per selected Page ID', () => {
    const pages = [page(1), page(2), page(3), page(4)]
    const selected = new Set([1, 2, 3, 900])
    const states = { 1: runtime('running'), 2: runtime('paused'), 3: runtime('idle'), 4: runtime('running') }
    expect(eligibleSelectedPageIds(pages, selected, states, 'start')).toEqual([3])
    expect(eligibleSelectedPageIds(pages, selected, states, 'pause')).toEqual([1])
    expect(eligibleSelectedPageIds(pages, selected, states, 'resume')).toEqual([2])
    expect(eligibleSelectedPageIds(pages, selected, states, 'stop')).toEqual([1, 2])
    expect(eligibleForBulkAction('waiting_window', 'pause')).toBe(true)
    expect(eligibleForBulkAction('waiting_window', 'stop')).toBe(true)
    expect(eligibleForBulkAction('paused', 'start')).toBe(false)
  })
})
