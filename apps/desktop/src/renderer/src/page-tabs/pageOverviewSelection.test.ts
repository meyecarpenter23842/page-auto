import { describe, expect, it } from 'vitest'
import {
  OVERVIEW_SELECTED_PAGE_KEY,
  readOverviewSelectedPageId,
  saveOverviewSelectedPageId
} from './pageOverviewSelection'

describe('Issue #521 R1 selected Page preference', () => {
  it('round-trips only the selected numeric Page ID', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) }
    }
    expect(readOverviewSelectedPageId(storage)).toBeNull()
    saveOverviewSelectedPageId(271, storage)
    expect(readOverviewSelectedPageId(storage)).toBe(271)
    expect([...values.entries()]).toEqual([[OVERVIEW_SELECTED_PAGE_KEY, '271']])
  })

  it('rejects malformed, negative, oversized or non-integer IDs', () => {
    for (const value of ['0', '-9', '1.5', '9e2', 'NaN', '{}', '9007199254740992', '']) {
      expect(readOverviewSelectedPageId({ getItem: () => value })).toBeNull()
    }
    const calls: string[] = []
    for (const id of [0, -1, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      saveOverviewSelectedPageId(id, { setItem: (_key, value) => { calls.push(value) } })
    }
    expect(calls).toEqual([])
  })

  it('tolerates disabled or broken storage without throwing', () => {
    expect(readOverviewSelectedPageId(null)).toBeNull()
    expect(readOverviewSelectedPageId({ getItem: () => { throw new Error('blocked') } })).toBeNull()
    expect(() => saveOverviewSelectedPageId(3, { setItem: () => { throw new Error('blocked') } })).not.toThrow()
  })
})
