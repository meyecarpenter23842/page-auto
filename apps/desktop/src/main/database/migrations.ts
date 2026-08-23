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
  },
  {
    version: 4,
    name: 'run_queue',
    sql: `
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        page_tab_id INTEGER REFERENCES page_tabs(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'created',
        tab_name TEXT NOT NULL,
        page_uid TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        paused_at INTEGER,
        completed_at INTEGER,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_runs_page_tab ON runs(page_tab_id, id);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_one_active_per_tab
        ON runs(page_tab_id)
        WHERE page_tab_id IS NOT NULL AND status IN ('created', 'running', 'paused');

      CREATE TABLE IF NOT EXISTS run_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        source_group_item_id INTEGER,
        group_uid TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        started_at INTEGER,
        finished_at INTEGER,
        updated_at INTEGER NOT NULL,
        UNIQUE(run_id, group_uid)
      );

      CREATE INDEX IF NOT EXISTS idx_run_items_queue ON run_items(run_id, status, sort_order, id);

      CREATE TABLE IF NOT EXISTS run_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        payload_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, id);
    `
  },
  {
    version: 5,
    name: 'recovery_execution_logs',
    sql: `
      CREATE TABLE IF NOT EXISTS execution_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        timestamp INTEGER NOT NULL,
        run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
        run_item_id INTEGER REFERENCES run_items(id) ON DELETE SET NULL,
        page_tab_id INTEGER,
        account_id INTEGER,
        page_uid TEXT,
        group_uid TEXT,
        content_index INTEGER,
        image_paths_json TEXT,
        action TEXT NOT NULL,
        result TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT,
        screenshot_path TEXT,
        published_url TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        retry_disposition TEXT NOT NULL DEFAULT 'not_applicable'
      );

      CREATE INDEX IF NOT EXISTS idx_execution_logs_time ON execution_logs(timestamp DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_execution_logs_tab ON execution_logs(page_tab_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_execution_logs_account ON execution_logs(account_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_execution_logs_group ON execution_logs(group_uid, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_execution_logs_result ON execution_logs(result, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_execution_logs_run_item ON execution_logs(run_item_id, id DESC);
    `
  }
]

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0
