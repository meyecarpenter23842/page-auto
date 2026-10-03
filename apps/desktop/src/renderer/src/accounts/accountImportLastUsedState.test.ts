import { describe, expect, it } from 'vitest'
import type { AccountImportMapping } from '../../../shared/accounts'
import {
  accountImportLastUsedStorageKey,
  loadAccountImportLastUsedState,
  saveAccountImportLastUsedState
} from './accountImportLastUsedState'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    values
  }
}

describe('account import last-used state', () => {
  it('remembers insert and update mappings independently', () => {
    const storage = memoryStorage()
    const insertMapping: AccountImportMapping = ['uid', 'cookie', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'note']
    const updateMapping: AccountImportMapping = ['uid', 'proxy', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore']

    saveAccountImportLastUsedState('insert', { delimiter: ';', mapping: insertMapping }, storage)
    saveAccountImportLastUsedState('update', { delimiter: '|', mapping: updateMapping }, storage)

    expect(loadAccountImportLastUsedState('insert', storage).delimiter).toBe(';')
    expect(loadAccountImportLastUsedState('insert', storage).mapping.slice(0, 2)).toEqual(['uid', 'cookie'])
    expect(loadAccountImportLastUsedState('update', storage).mapping.slice(0, 2)).toEqual(['uid', 'proxy'])
  })

  it('keeps ignore choices and repairs invalid stored fields', () => {
    const storage = memoryStorage()
    storage.setItem(accountImportLastUsedStorageKey('update'), JSON.stringify({
      delimiter: ',',
      mapping: ['uid', 'not-a-field', 'ignore']
    }))

    const state = loadAccountImportLastUsedState('update', storage)
    expect(state.delimiter).toBe(',')
    expect(state.mapping.slice(0, 3)).toEqual(['uid', 'ignore', 'ignore'])
    expect(state.mapping.length).toBeGreaterThanOrEqual(9)
  })
})
