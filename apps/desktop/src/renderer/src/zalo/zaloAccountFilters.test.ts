import { describe, expect, it } from 'vitest'
import { filterZaloAccounts, toggleVisibleZaloAccounts } from './zaloAccountFilters'
const accounts = [
  { phone: '09001', displayName: 'Một', note: 'Alpha', sessionStatus: 'ready' },
  { phone: '09002', displayName: 'Hai', note: 'Beta', sessionStatus: 'login_required' },
  { phone: '09003', displayName: 'Ba', note: '', sessionStatus: 'browser_error' }
] as const
describe('Zalo account selection UI helpers', () => {
  it('filters by phone/name/note without changing original order', () => {
    expect(filterZaloAccounts(accounts, 'beta', 'all').map((x) => x.phone)).toEqual(['09002'])
    expect(filterZaloAccounts(accounts, '', 'ready').map((x) => x.phone)).toEqual(['09001'])
    expect(filterZaloAccounts(accounts, '', 'attention').map((x) => x.phone)).toEqual(['09002', '09003'])
    expect(accounts.map((x) => x.phone)).toEqual(['09001', '09002', '09003'])
  })
  it('selects visible ids only, preserving other selections', () => {
    expect(toggleVisibleZaloAccounts([1, 3], [2, 3], false)).toEqual([1, 3, 2])
    expect(toggleVisibleZaloAccounts([1, 2, 3], [2, 3], true)).toEqual([1])
  })
})
