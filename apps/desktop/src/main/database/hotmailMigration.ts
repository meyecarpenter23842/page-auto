import type Database from 'better-sqlite3'

export const HOTMAIL_SCHEMA_VERSION = 9
export const HOTMAIL_MIGRATION_NAME = 'hotmail_account_oauth_binding'

interface HotmailMigration {
  version: number
  name: string
  sql: string
}

const HOTMAIL_MIGRATIONS: HotmailMigration[] = [
  {
    version: 8,
    name: 'hotmail_auto_subsystem',
    sql: `
      CREATE TABLE IF NOT EXISTS account_email_state (
        account_id INTEGER PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        provider TEXT NOT NULL DEFAULT 'microsoft',
        oauth_status TEXT NOT NULL DEFAULT 'missing',
        refresh_token_ciphertext TEXT,
        mail_status TEXT NOT NULL DEFAULT 'unknown',
        last_check_at INTEGER,
        last_code TEXT,
        last_code_at INTEGER,
        last_error TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_account_email_oauth_status ON account_email_state(oauth_status);
      CREATE INDEX IF NOT EXISTS idx_account_email_mail_status ON account_email_state(mail_status);

      CREATE TABLE IF NOT EXISTS email_profile_settings (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
        external_root TEXT NOT NULL DEFAULT '',
        browser_executable TEXT NOT NULL DEFAULT '',
        oauth_client_id TEXT NOT NULL DEFAULT '',
        oauth_tenant TEXT NOT NULL DEFAULT 'consumers',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS email_proxy_settings (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
        mode TEXT NOT NULL DEFAULT 'direct',
        proxy_list_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      );
    `
  },
  {
    version: 9,
    name: HOTMAIL_MIGRATION_NAME,
    sql: `
      ALTER TABLE account_email_state ADD COLUMN oauth_client_id TEXT;
      ALTER TABLE account_email_state ADD COLUMN oauth_updated_at INTEGER;
      ALTER TABLE account_email_state ADD COLUMN last_token_check_at INTEGER;

      UPDATE account_email_state
      SET
        oauth_client_id = NULLIF(
          (SELECT oauth_client_id FROM email_profile_settings WHERE id = 1),
          ''
        ),
        oauth_updated_at = COALESCE(oauth_updated_at, updated_at)
      WHERE refresh_token_ciphertext IS NOT NULL
        AND (oauth_client_id IS NULL OR TRIM(oauth_client_id) = '');
    `
  }
]

export function applyHotmailMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const hasMigration = client.prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?')
    const recordMigration = client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    )

    for (const migration of HOTMAIL_MIGRATIONS) {
      if (hasMigration.get(migration.version)) continue
      client.exec(migration.sql)
      recordMigration.run(migration.version, migration.name, Date.now())
    }
  })

  migrate()
}
