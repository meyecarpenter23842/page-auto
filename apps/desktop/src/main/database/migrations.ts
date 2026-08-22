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
  },
  {
    version: 3,
    name: 'page_tab_config',
    sql: `
      CREATE TABLE IF NOT EXISTS page_tabs (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        name TEXT NOT NULL,
        page_uid TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        posts_per_account INTEGER NOT NULL DEFAULT 1,
        post_delay_min_seconds INTEGER NOT NULL DEFAULT 180,
        post_delay_max_seconds INTEGER NOT NULL DEFAULT 300,
        account_delay_min_seconds INTEGER NOT NULL DEFAULT 600,
        account_delay_max_seconds INTEGER NOT NULL DEFAULT 900,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_page_tabs_page_uid ON page_tabs(page_uid);
      CREATE INDEX IF NOT EXISTS idx_page_tabs_status ON page_tabs(status);

      CREATE TABLE IF NOT EXISTS page_tab_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        page_tab_id INTEGER NOT NULL REFERENCES page_tabs(id) ON DELETE CASCADE,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        posts_per_turn INTEGER,
        UNIQUE(page_tab_id, account_id)
      );

      CREATE INDEX IF NOT EXISTS idx_page_tab_accounts_order ON page_tab_accounts(page_tab_id, sort_order);

      CREATE TABLE IF NOT EXISTS page_tab_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        page_tab_id INTEGER NOT NULL REFERENCES page_tabs(id) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL,
        start_minute INTEGER NOT NULL,
        end_minute INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_page_tab_schedules_order ON page_tab_schedules(page_tab_id, day_of_week, sort_order);

      CREATE TABLE IF NOT EXISTS group_sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        page_tab_id INTEGER NOT NULL UNIQUE REFERENCES page_tabs(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS group_set_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        group_set_id INTEGER NOT NULL REFERENCES group_sets(id) ON DELETE CASCADE,
        group_uid TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        UNIQUE(group_set_id, group_uid)
      );

      CREATE INDEX IF NOT EXISTS idx_group_set_items_order ON group_set_items(group_set_id, sort_order);

      CREATE TABLE IF NOT EXISTS content_sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        page_tab_id INTEGER NOT NULL UNIQUE REFERENCES page_tabs(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'sequential',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS content_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        content_set_id INTEGER NOT NULL REFERENCES content_sets(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        sort_order INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_content_items_order ON content_items(content_set_id, sort_order);

      CREATE TABLE IF NOT EXISTS image_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        page_tab_id INTEGER NOT NULL UNIQUE REFERENCES page_tabs(id) ON DELETE CASCADE,
        folder_path TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL DEFAULT 'sequential',
        images_per_post INTEGER NOT NULL DEFAULT 1,
        missing_policy TEXT NOT NULL DEFAULT 'text_only',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `
  }
]

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0
