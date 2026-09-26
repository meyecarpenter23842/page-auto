import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyProxyCenterMigration,
  PROXY_CENTER_INVENTORY_MIGRATION_NAME,
  PROXY_CENTER_INVENTORY_SCHEMA_VERSION,
  PROXY_CENTER_MIGRATION_NAME,
  PROXY_CENTER_SCHEMA_VERSION
} from './proxyCenterMigration'
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

    const migrations = db.prepare(
      'SELECT version, name FROM __page_auto_migrations WHERE version IN (?, ?) ORDER BY version'
    ).all(PROXY_CENTER_INVENTORY_SCHEMA_VERSION, PROXY_CENTER_SCHEMA_VERSION)
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'proxy_inventory'"
    ).get()
    const folders = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'proxy_folders'"
    ).get()

    expect(migrations).toEqual([
      {
        version: PROXY_CENTER_INVENTORY_SCHEMA_VERSION,
        name: PROXY_CENTER_INVENTORY_MIGRATION_NAME
      },
      {
        version: PROXY_CENTER_SCHEMA_VERSION,
        name: PROXY_CENTER_MIGRATION_NAME
      }
    ])
    expect(table).toBeTruthy()
    expect(folders).toBeTruthy()
  })

  it('upgrades the previous inventory schema without losing proxy rows', () => {
    db.exec(`
      CREATE TABLE proxy_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT NOT NULL DEFAULT '',
        password TEXT NOT NULL DEFAULT '',
        ip_family TEXT NOT NULL DEFAULT 'unknown',
        outbound_ip TEXT,
        status TEXT NOT NULL DEFAULT 'unknown',
        latency_ms INTEGER,
        last_error TEXT,
        source_kind TEXT NOT NULL DEFAULT 'import',
        source_label TEXT,
        last_checked_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(host, port, username)
      );
      INSERT INTO proxy_inventory (
        host, port, username, password, created_at, updated_at
      ) VALUES ('127.0.0.1', 3128, 'legacy', 'secret', 1, 1);
      INSERT INTO __page_auto_migrations (version, name, applied_at)
      VALUES (33, 'proxy_center_inventory', 1);
    `)

    applyProxyCenterMigration(db)

    const columns = db.prepare('PRAGMA table_info(proxy_inventory)').all() as Array<{ name: string }>
    expect(columns.some((column) => column.name === 'folder_id')).toBe(true)
    expect(new ProxyCenterInventoryRepository(db).list()).toHaveLength(1)
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

  it('keeps proxy folders persistent and returns deleted-folder proxies to unfiled', () => {
    applyProxyCenterMigration(db)
    const repository = new ProxyCenterInventoryRepository(db)
    const inserted = repository.upsert({
      items: [
        { rawProxy: '127.0.0.1:3128:user-a:secret-a' },
        { rawProxy: '127.0.0.1:3129:user-b:secret-b' }
      ]
    })

    const folders = repository.createFolder('VPS US 01')
    expect(folders).toHaveLength(1)
    const folderId = folders[0]?.id ?? 0
    const ids = inserted.records.map((item) => item.id)
    const assigned = repository.assignFolder(ids, folderId)
    expect(assigned.every((item) => item.folderId === folderId)).toBe(true)
    expect(repository.listFolders()[0]?.proxyCount).toBe(2)

    repository.deleteFolder(folderId)
    expect(repository.listFolders()).toHaveLength(0)
    expect(repository.list().every((item) => item.folderId === null)).toBe(true)
  })
})
