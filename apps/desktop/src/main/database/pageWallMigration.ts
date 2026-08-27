import type Database from 'better-sqlite3'

export const PAGE_WALL_SCHEMA_VERSION = 10
export const PAGE_WALL_MIGRATION_NAME = 'page_wall_scheduled_jobs'

export function applyPageWallMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const exists = client.prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?').get(PAGE_WALL_SCHEMA_VERSION)
    if (exists) return

    client.exec(`
      CREATE TABLE IF NOT EXISTS page_wall_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed', 'cancelled')),
        scheduled_at INTEGER NOT NULL,
        page_tab_id INTEGER NOT NULL,
        page_tab_name TEXT NOT NULL,
        page_uid TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        account_uid TEXT NOT NULL,
        account_name TEXT,
        content TEXT NOT NULL DEFAULT '',
        image_paths_json TEXT NOT NULL DEFAULT '[]',
        result_status TEXT,
        result_code TEXT,
        result_message TEXT,
        published_url TEXT,
        screenshot_path TEXT,
        trace_path TEXT,
        session_validation_json TEXT,
        logs_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_page_wall_jobs_due
        ON page_wall_jobs(status, scheduled_at, id);
      CREATE INDEX IF NOT EXISTS idx_page_wall_jobs_page
        ON page_wall_jobs(page_tab_id, scheduled_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_page_wall_jobs_account
        ON page_wall_jobs(account_id, scheduled_at DESC, id DESC);
    `)

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(PAGE_WALL_SCHEMA_VERSION, PAGE_WALL_MIGRATION_NAME, Date.now())
  })

  migrate()
}
