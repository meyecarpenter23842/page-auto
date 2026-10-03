import { describe, expect, it } from 'vitest'
import {
  loadPageWallLastUsedState,
  pageWallLastUsedStorageKey,
  savePageWallLastUsedState
} from './pageWallLastUsedState'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    values
  }
}

describe('Page Wall last-used state', () => {
  it('preserves an intentional empty account selection per Page', () => {
    const storage = memoryStorage()
    savePageWallLastUsedState(12, {
      selectedAccountIds: [],
      accountConcurrency: 3,
      runDelaySeconds: 45
    }, storage)

    expect(loadPageWallLastUsedState(12, storage)).toEqual({
      selectedAccountIds: [],
      accountConcurrency: 3,
      runDelaySeconds: 45
    })
    expect(loadPageWallLastUsedState(13, storage)).toBeNull()
  })

  it('deduplicates account ids and clamps numeric preferences', () => {
    const storage = memoryStorage()
    storage.setItem(pageWallLastUsedStorageKey(7), JSON.stringify({
      selectedAccountIds: [5, 5, -1, 9, 0],
      accountConcurrency: 99,
      runDelaySeconds: -10
    }))

    expect(loadPageWallLastUsedState(7, storage)).toEqual({
      selectedAccountIds: [5, 9],
      accountConcurrency: 20,
      runDelaySeconds: 0
    })
  })
})
