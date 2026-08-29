import type Database from 'better-sqlite3'

export const ACCOUNT_GROUP_SCHEMA_VERSION = 12
export const ACCOUNT_GROUP_MIGRATION_NAME = 'account_group_manager'

export function applyAccountGroupMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const exists = client.prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?').get(ACCOUNT_GROUP_SCHEMA_VERSION)
    if (exists) return

    client.exec(`
      CREATE TABLE IF NOT EXISTS account_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_account_groups_name_nocase
        ON account_groups(name COLLATE NOCASE);

      CREATE INDEX IF NOT EXISTS idx_account_groups_updated
        ON account_groups(updated_at DESC, id DESC);
    `)

    const now = Date.now()
    const legacyNames = client.prepare(`
      SELECT DISTINCT TRIM(category) AS name
      FROM accounts
      WHERE TRIM(COALESCE(category, '')) <> ''
      ORDER BY name COLLATE NOCASE
    `).all() as Array<{ name: string }>
    const insert = client.prepare(`
      INSERT OR IGNORE INTO account_groups (name, created_at, updated_at)
      VALUES (?, ?, ?)
    `)
    for (const row of legacyNames) insert.run(row.name, now, now)

    client.exec(`
      UPDATE accounts
      SET category = (
        SELECT g.name
        FROM account_groups g
        WHERE g.name = TRIM(accounts.category) COLLATE NOCASE
        LIMIT 1
      )
      WHERE TRIM(COALESCE(category, '')) <> ''
        AND category <> (
          SELECT g.name
          FROM account_groups g
          WHERE g.name = TRIM(accounts.category) COLLATE NOCASE
          LIMIT 1
        );
    `)

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(ACCOUNT_GROUP_SCHEMA_VERSION, ACCOUNT_GROUP_MIGRATION_NAME, now)
  })

  migrate()
}
