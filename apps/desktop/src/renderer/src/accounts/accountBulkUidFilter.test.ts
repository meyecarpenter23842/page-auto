import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeBulkUidFilter } from './accountManagerModel'

const manager = readFileSync(new URL('./AccountManager.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./accounts.css', import.meta.url), 'utf8')

describe('Account Manager bulk UID filter', () => {
  it('treats each line as exactly one UID and removes blanks/duplicates', () => {
    expect(normalizeBulkUidFilter(' 1001\r\n1002\n\n1001\n 1003 ')).toEqual(['1001', '1002', '1003'])
  })

  it('does not invent delimiter parsing for pipe/comma text', () => {
    expect(normalizeBulkUidFilter('1001|1002\n1003,1004')).toEqual(['1001|1002', '1003,1004'])
  })

  it('keeps the Account toolbar compact and exposes one UID-filter action in the right-click menu', () => {
    expect(manager).toContain('bulk-uid-filter-button')
    expect(manager).toContain('>UID{bulkUidFilter.length')
    expect(manager).toContain('uidFilter.has(account.uid.trim())')
    const menuStart = manager.indexOf('{contextMenu ? (')
    const menuEnd = manager.indexOf('{groupPickerOpen ? (')
    const menuSource = manager.slice(menuStart, menuEnd)
    expect(menuSource.match(/Lọc UID hàng loạt…/g)).toHaveLength(1)
    expect(css).toContain('.bulk-uid-filter-button')
    expect(css).toContain('.bulk-uid-filter-modal')
  })
})
