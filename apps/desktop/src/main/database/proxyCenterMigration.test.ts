import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyProxyCenterMigration, PROXY_CENTER_MIGRATION_NAME, PROXY_CENTER_SCHEMA_VERSION } from './proxyCenterMigration'
import { ProxyCenterInventoryRepository } from './proxyInventoryRepository'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE __page_auto_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `)
})

afterEach(() => db.close())

describe('Proxy Center inventory persistence', () => {
  it('creates the versioned inventory schema idempotently', () => {
    applyProxyCenterMigration(db)
    applyProxyCenterMigration(db)

    const migration = db.prepare(
      'SELECT version, name FROM __page_auto_migrations WHERE version = ?'
    ).get(PROXY_CENTER_SCHEMA_VERSION)
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'proxy_inventory'"
    ).get()

    expect(migration).toEqual({
      version: PROXY_CENTER_SCHEMA_VERSION,
      name: PROXY_CENTER_MIGRATION_NAME
    })
    expect(table).toBeTruthy()
  })

  it('stores secrets locally but never returns the password in public inventory records', () => {
    applyProxyCenterMigration(db)
    const repository = new ProxyCenterInventoryRepository(db)

    const first = repository.upsert({
      items: [{
        rawProxy: '127.0.0.1:3128:proxy-user:first-secret',
        sourceKind: 'import'
      }]
    })

    expect(first.inserted).toBe(1)
    expect(first.records).toHaveLength(1)
    expect(first.records[0]?.maskedProxy).toBe('127.0.0.1:3128:proxy-user:••••')
    expect(JSON.stringify(first.records)).not.toContain('first-secret')

    const id = first.records[0]?.id ?? 0
    expect(repository.getSecret(id)?.password).toBe('first-secret')

    const second = repository.upsert({
      items: [{
        rawProxy: '127.0.0.1:3128:proxy-user:second-secret',
        sourceKind: 'builder',
        sourceLabel: 'vps-a',
        status: 'live',
        ipFamily: 'ipv4',
        outboundIp: '203.0.113.10',
        lastCheckedAt: 123
      }]
    })

    expect(second.inserted).toBe(0)
    expect(second.updated).toBe(1)
    expect(second.records).toHaveLength(1)
    expect(second.records[0]?.status).toBe('live')
    expect(second.records[0]?.sourceKind).toBe('builder')
    expect(repository.getSecret(id)?.password).toBe('second-secret')
  })
})
