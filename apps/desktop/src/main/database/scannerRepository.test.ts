import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyScannerMigration } from './scannerMigration'
import { ScannerRepository } from './scannerRepository'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE __page_auto_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
    CREATE TABLE accounts (id INTEGER PRIMARY KEY NOT NULL);
    INSERT INTO accounts(id) VALUES (1);
  `)
  applyScannerMigration(db)
})

afterEach(() => db.close())

describe('ScannerRepository foundation', () => {
  it('persists a typed job, results and immutable Dataset snapshot', () => {
    const repository = new ScannerRepository(db)
    const created = repository.createJob({
      scanType: 'group',
      source: { type: 'account', accountId: 1 },
      query: 'mỹ phẩm',
      filters: { membersMin: 1000 },
      limit: 50
    }, 100)

    expect(created.status).toBe('queued')
    expect(created.source).toEqual({ type: 'account', accountId: 1 })

    repository.setJobStatus(created.id, 'running', null, 110)
    repository.addResult(created.id, {
      entityId: 'g-1',
      displayName: 'Group 1',
      url: 'https://www.facebook.com/groups/g-1',
      status: 'success',
      data: { members: 12345, privacy: 'Public' },
      scannedAt: 120
    }, 120)
    repository.setJobStatus(created.id, 'completed', null, 130)

    const completed = repository.getJob(created.id)
    expect(completed?.resultCount).toBe(1)
    expect(completed?.acceptedCount).toBe(1)
    expect(completed?.results[0]?.data.members).toBe(12345)

    const dataset = repository.createDatasetFromJob({ jobId: created.id, name: 'Group mỹ phẩm' }, 140)
    expect(dataset.type).toBe('group')
    expect(dataset.recordCount).toBe(1)
    expect(dataset.items[0]?.entityId).toBe('g-1')

    repository.addResult(created.id, {
      entityId: 'g-2',
      displayName: 'Group 2',
      url: null,
      status: 'success',
      data: { members: 99 },
      scannedAt: 150
    }, 150)

    expect(repository.getDataset(dataset.id)?.recordCount).toBe(1)
    expect(repository.getJob(created.id)?.resultCount).toBe(2)
  })

  it('marks interrupted queued/running/paused jobs as needs_attention on recovery', () => {
    const repository = new ScannerRepository(db)
    const job = repository.createJob({
      scanType: 'page',
      source: { type: 'account', accountId: 1 },
      query: '',
      filters: {},
      limit: 10
    }, 200)
    repository.setJobStatus(job.id, 'running', null, 210)

    expect(repository.recoverInterrupted(220)).toBe(1)
    expect(repository.getJob(job.id)?.status).toBe('needs_attention')
    expect(repository.getJob(job.id)?.finishedAt).toBe(220)
  })
})
