import type Database from 'better-sqlite3'

export const PROXY_CENTER_INVENTORY_SCHEMA_VERSION = 33
export const PROXY_CENTER_INVENTORY_MIGRATION_NAME = 'proxy_center_inventory'
export const PROXY_CENTER_SCHEMA_VERSION = 34
export const PROXY_CENTER_MIGRATION_NAME = 'proxy_center_folders'

function hasColumn(client: Database.Database, table: string, column: string): boolean {
  const rows = client.prepare('PRAGMA table_info(' + table + ')').all() as Array<{ name: string }>
  return rows.some((row) => row.name === column)
}

function recordMigration(
  client: Database.Database,
  version: number,
  name: string
): void {
  const applied = client
    .prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?')
    .get(version)
  if (applied) return

  client.prepare(
    'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
  ).run(version, name, Date.now())
}

export function applyProxyCenterMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    client.exec(`
      CREATE TABLE IF NOT EXISTS proxy_inventory (
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

      CREATE INDEX IF NOT EXISTS idx_proxy_inventory_status_updated
        ON proxy_inventory(status, updated_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_proxy_inventory_endpoint
        ON proxy_inventory(host, port, username);
    `)

    recordMigration(
      client,
      PROXY_CENTER_INVENTORY_SCHEMA_VERSION,
      PROXY_CENTER_INVENTORY_MIGRATION_NAME
    )

    client.exec(`
      CREATE TABLE IF NOT EXISTS proxy_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)

    if (!hasColumn(client, 'proxy_inventory', 'folder_id')) {
      client.exec('ALTER TABLE proxy_inventory ADD COLUMN folder_id INTEGER')
    }

    client.exec(`
      CREATE INDEX IF NOT EXISTS idx_proxy_inventory_folder
        ON proxy_inventory(folder_id, updated_at DESC, id DESC);
    `)

    recordMigration(client, PROXY_CENTER_SCHEMA_VERSION, PROXY_CENTER_MIGRATION_NAME)
  })

  migrate()
}
