import type Database from 'better-sqlite3'

export const ZALO_SCHEMA_VERSION = 28
export const ZALO_MIGRATION_NAME = 'zalo_foundation'

export function applyZaloMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const applied = client
      .prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?')
      .get(ZALO_SCHEMA_VERSION)
    if (applied) return

    client.exec(`
      CREATE TABLE IF NOT EXISTS zalo_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        password TEXT,
        display_name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        session_status TEXT NOT NULL DEFAULT 'unknown',
        note TEXT,
        last_opened_at INTEGER,
        last_login_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_zalo_accounts_status_updated
        ON zalo_accounts(status, updated_at DESC, id DESC);
    `)

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(ZALO_SCHEMA_VERSION, ZALO_MIGRATION_NAME, Date.now())
  })

  migrate()
}
