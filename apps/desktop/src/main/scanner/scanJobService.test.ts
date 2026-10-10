import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyScannerMigration } from '../database/scannerMigration'
import { ScannerRepository } from '../database/scannerRepository'
import type { StartScanJobInput } from '../../shared/scanner'
import type { ScanAdapter, ScanAdapterControl, ScanAdapterRecord } from './scanAdapter'
import { ScanJobService } from './scanJobService'
import { ScannerAdapterRegistry } from './scannerAdapterRegistry'

let db: Database.Database

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timeout chờ Scanner state trong test.')
}

function record(entityId: string): ScanAdapterRecord {
  return { entityId, displayName: entityId, url: null, status: 'success', data: {} }
}

function input(): StartScanJobInput {
  return {
    scanType: 'group',
    source: { type: 'account', accountId: 1 },
    query: 'demo',
    filters: {},
    limit: 10
  }
}

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

describe('ScanJobService cooperative production control', () => {
  it('propagates pause/resume into adapter pagination before the next record is emitted', async () => {
    const gate = deferred()
    const states: string[] = []
    const adapter: ScanAdapter = {
      scanType: 'group',
      async *scan(_input: StartScanJobInput, control: ScanAdapterControl) {
        const unsubscribe = control.onStateChange((state) => states.push(state))
        try {
          yield record('1')
          await gate.promise
          if (!await control.waitIfPaused()) return
          yield record('2')
        } finally {
          unsubscribe()
        }
      }
    }
    const repository = new ScannerRepository(db)
    const service = new ScanJobService(repository, new ScannerAdapterRegistry([adapter]))
    const job = service.start(input())
    await waitFor(() => service.get(job.id)?.resultCount === 1)

    expect(service.pause(job.id)?.status).toBe('paused')
    gate.resolve()
    await new Promise<void>((resolve) => setTimeout(resolve, 80))
    expect(service.get(job.id)?.resultCount).toBe(1)
    expect(states).toContain('paused')

    expect(service.resume(job.id)?.status).toBe('running')
    await waitFor(() => service.get(job.id)?.status === 'completed')
    expect(service.get(job.id)?.resultCount).toBe(2)
    expect(states).toContain('running')
  })

  it('stops before the next pagination batch and preserves partial results', async () => {
    const gate = deferred()
    const adapter: ScanAdapter = {
      scanType: 'group',
      async *scan(_input: StartScanJobInput, control: ScanAdapterControl) {
        yield record('1')
        await gate.promise
        if (!await control.waitIfPaused()) return
        yield record('2')
      }
    }
    const repository = new ScannerRepository(db)
    const service = new ScanJobService(repository, new ScannerAdapterRegistry([adapter]))
    const job = service.start(input())
    await waitFor(() => service.get(job.id)?.resultCount === 1)

    expect(service.stop(job.id)?.status).toBe('stopped')
    gate.resolve()
    await new Promise<void>((resolve) => setTimeout(resolve, 80))
    expect(service.get(job.id)?.status).toBe('stopped')
    expect(service.get(job.id)?.resultCount).toBe(1)
  })
})
