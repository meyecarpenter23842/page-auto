export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'bootstrap_app_settings',
    sql: `
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `
  },
  {
    version: 2,
    name: 'account_manager',
    sql: `
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        uid TEXT NOT NULL UNIQUE,
        username TEXT,
        password TEXT,
        name TEXT,
        status TEXT NOT NULL DEFAULT 'unknown',
        category TEXT,
        friend_count INTEGER,
        cookie TEXT,
        cookie_status TEXT,
        last_cookie_check INTEGER,
        proxy TEXT,
        proxy_type TEXT,
        proxy_host TEXT,
        proxy_port INTEGER,
        proxy_username TEXT,
        proxy_password TEXT,
        two_factor_secret TEXT,
        email TEXT,
        email_password TEXT,
        backup_email TEXT,
        phone TEXT,
        user_agent TEXT,
        created_date TEXT,
        note TEXT,
        last_used_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
      CREATE INDEX IF NOT EXISTS idx_accounts_category ON accounts(category);

      CREATE TABLE IF NOT EXISTS import_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        name TEXT NOT NULL UNIQUE,
        delimiter TEXT NOT NULL DEFAULT '|',
        mapping_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS column_layouts (
        view_key TEXT PRIMARY KEY NOT NULL,
        layout_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `
  }
]

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0
