import { describe, expect, it } from 'vitest'
import { parseAccountImport } from './accountImport'

describe('parseAccountImport', () => {
  it('maps custom columns and trims values', () => {
    const parsed = parseAccountImport({
      rawText: ' 10001 | pass | cookie-value | note one \n10002|pass2|cookie-two|note two',
      delimiter: '|',
      mapping: ['uid', 'password', 'cookie', 'note'],
      duplicatePolicy: 'skip'
    })

    expect(parsed.errors).toEqual([])
    expect(parsed.accounts).toEqual([
      { uid: '10001', password: 'pass', cookie: 'cookie-value', note: 'note one' },
      { uid: '10002', password: 'pass2', cookie: 'cookie-two', note: 'note two' }
    ])
  })

  it('reports missing and duplicate UID without exposing other fields', () => {
    const parsed = parseAccountImport({
      rawText: '|secret-cookie\n10001|cookie-a\n10001|cookie-b',
      delimiter: '|',
      mapping: ['uid', 'cookie'],
      duplicatePolicy: 'skip'
    })

    expect(parsed.accounts).toEqual([{ uid: '10001', cookie: 'cookie-a' }])
    expect(parsed.errors).toEqual([
      { line: 1, message: 'Thiếu UID/UserName.' },
      { line: 3, message: 'UID/UserName bị trùng trong dữ liệu import: 10001' }
    ])
    expect(JSON.stringify(parsed.errors)).not.toContain('secret-cookie')
    expect(JSON.stringify(parsed.errors)).not.toContain('cookie-b')
  })

  it('validates numeric mapped fields', () => {
    const parsed = parseAccountImport({
      rawText: '10001|abc',
      delimiter: '|',
      mapping: ['uid', 'friendCount'],
      duplicatePolicy: 'skip'
    })

    expect(parsed.accounts).toEqual([])
    expect(parsed.errors).toEqual([{ line: 1, message: 'friendCount phải là số.' }])
  })
})
