import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyScannerMigration } from '../database/scannerMigration'
import { ScannerRepository } from '../database/scannerRepository'
import type { StartScanJobInput } from '../../shared/scanner'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE __page_auto_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
    CREATE TABLE accounts (id INTEGER PRIMARY KEY NOT NULL);
    INSERT INTO accounts(id) VALUES (1), (2);
  `)
  applyScannerMigration(db)
})

afterEach(() => db.close())

describe('Scanner source snapshot contract', () => {
  it('persists the account source snapshot instead of retaining mutable input state', () => {
    const repository = new ScannerRepository(db)
    const input: StartScanJobInput = {
      scanType: 'page',
      source: { type: 'account', accountId: 1 },
      query: 'fixture',
      filters: {},
      limit: 10
    }
    const job = repository.createJob(input, 100)

    input.source = { type: 'account', accountId: 2 }

    expect(repository.getJob(job.id)?.source).toEqual({ type: 'account', accountId: 1 })
  })

  it('persists only token credential identity in a job snapshot, never a raw token', () => {
    const repository = new ScannerRepository(db)
    const job = repository.createJob({
      scanType: 'page',
      source: { type: 'token', credentialId: 'credential-fixture' },
      query: '',
      filters: {},
      limit: 10
    }, 200)

    const row = db.prepare(`
      SELECT source_type AS sourceType, source_credential_ref AS credentialRef, filters_json AS filtersJson
      FROM scan_jobs WHERE id = ?
    `).get(job.id) as { sourceType: string; credentialRef: string; filtersJson: string }

    expect(row).toEqual({ sourceType: 'token', credentialRef: 'credential-fixture', filtersJson: '{}' })
    expect(JSON.stringify(repository.getJob(job.id))).not.toContain('accessToken')
  })
})
