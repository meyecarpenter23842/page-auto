import type Database from 'better-sqlite3'

export const HOTMAIL_SCHEMA_VERSION = 8
export const HOTMAIL_MIGRATION_NAME = 'hotmail_auto_subsystem'

const HOTMAIL_MIGRATION_SQL = `
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

export function applyHotmailMigration(client: Database.Database): void {
  const applied = client.prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?').get(HOTMAIL_SCHEMA_VERSION)
  if (applied) return

  const migrate = client.transaction(() => {
    client.exec(HOTMAIL_MIGRATION_SQL)
    client.prepare('INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(HOTMAIL_SCHEMA_VERSION, HOTMAIL_MIGRATION_NAME, Date.now())
  })
  migrate()
}
