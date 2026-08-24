import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseAccountImport } from './accountImport'
import { AccountRepository } from './accountRepository'
import { initializeDatabase } from './index'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-account-update-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  return { runtime, repository: new AccountRepository(runtime.client) }
}

describe('account import delimiter semantics', () => {
  it('keeps uid||2fa positions without shifting fields', () => {
    const parsed = parseAccountImport({
      rawText: '10001||ABC2FA',
      delimiter: '|',
      mapping: ['uid', 'password', 'twoFactorSecret'],
      operation: 'insert'
    })

    expect(parsed.errors).toEqual([])
    expect(parsed.accounts).toEqual([{ uid: '10001', twoFactorSecret: 'ABC2FA' }])
  })

  it('treats explicit empty update cells as clear and absent cells as untouched', () => {
    const parsed = parseAccountImport({
      rawText: '10001||NEW2FA|',
      delimiter: '|',
      mapping: ['uid', 'password', 'twoFactorSecret', 'cookie', 'email'],
      operation: 'update'
    })

    expect(parsed.errors).toEqual([])
    expect(parsed.accounts).toEqual([{ uid: '10001', password: null, twoFactorSecret: 'NEW2FA', cookie: null }])
    expect(parsed.accounts[0]).not.toHaveProperty('email')
  })

  it('preserves multiple and trailing empty column positions', () => {
    const multiple = parseAccountImport({
      rawText: '10001|||cookie-value',
      delimiter: '|',
      mapping: ['uid', 'password', 'twoFactorSecret', 'cookie'],
      operation: 'update'
    })
    const trailing = parseAccountImport({
      rawText: '10001|pass|',
      delimiter: '|',
      mapping: ['uid', 'password', 'twoFactorSecret'],
      operation: 'update'
    })

    expect(multiple.accounts).toEqual([{ uid: '10001', password: null, twoFactorSecret: null, cookie: 'cookie-value' }])
    expect(trailing.accounts).toEqual([{ uid: '10001', password: 'pass', twoFactorSecret: null }])
  })
})

describe('AccountRepository explicit import/update operations', () => {
  it('does not overwrite an existing UID during insert', () => {
    const { runtime, repository } = createRepository()
    repository.create({ uid: '10001', note: 'old' })

    const result = repository.import({
      rawText: '10001|new\n10002|fresh',
      delimiter: '|',
      mapping: ['uid', 'note'],
      operation: 'insert'
    })

    expect(result).toMatchObject({ imported: 1, updated: 0, skipped: 1 })
    expect(repository.getByUid('10001')?.note).toBe('old')
    expect(repository.getByUid('10002')?.note).toBe('fresh')
    runtime.close()
  })

  it('updates by UID, clears explicit empty fields and preserves missing fields', () => {
    const { runtime, repository } = createRepository()
    repository.create({
      uid: '10001',
      password: 'old-pass',
      twoFactorSecret: 'OLD2FA',
      email: 'keep@example.com',
      note: 'keep-note'
    })

    const result = repository.import({
      rawText: '10001||NEW2FA',
      delimiter: '|',
      mapping: ['uid', 'password', 'twoFactorSecret', 'email', 'note'],
      operation: 'update'
    })

    expect(result).toMatchObject({ imported: 0, updated: 1, skipped: 0, errors: [] })
    const updated = repository.getByUid('10001')
    expect(updated?.uid).toBe('10001')
    expect(updated?.password).toBeNull()
    expect(updated?.twoFactorSecret).toBe('NEW2FA')
    expect(updated?.email).toBe('keep@example.com')
    expect(updated?.note).toBe('keep-note')
    runtime.close()
  })

  it('keeps ignored fields and never creates a missing UID during update', () => {
    const { runtime, repository } = createRepository()
    repository.create({ uid: '10001', password: 'keep-pass', twoFactorSecret: 'OLD2FA' })

    const updated = repository.import({
      rawText: '10001||NEW2FA',
      delimiter: '|',
      mapping: ['uid', 'ignore', 'twoFactorSecret'],
      operation: 'update'
    })
    const missing = repository.import({
      rawText: '99999|new-note',
      delimiter: '|',
      mapping: ['uid', 'note'],
      operation: 'update'
    })

    expect(updated).toMatchObject({ imported: 0, updated: 1, skipped: 0 })
    expect(repository.getByUid('10001')?.password).toBe('keep-pass')
    expect(repository.getByUid('10001')?.twoFactorSecret).toBe('NEW2FA')
    expect(missing).toMatchObject({ imported: 0, updated: 0, skipped: 1 })
    expect(repository.getByUid('99999')).toBeNull()
    runtime.close()
  })

  it('keeps the legacy duplicatePolicy behavior for existing callers', () => {
    const { runtime, repository } = createRepository()
    repository.create({ uid: '10001', note: 'old' })

    const result = repository.import({
      rawText: '10001|new',
      delimiter: '|',
      mapping: ['uid', 'note'],
      duplicatePolicy: 'update'
    })

    expect(result.updated).toBe(1)
    expect(repository.getByUid('10001')?.note).toBe('new')
    runtime.close()
  })
})
