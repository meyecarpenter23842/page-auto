import type Database from 'better-sqlite3'

export const PAGE_WALL_RECURRING_SCHEMA_VERSION = 21
export const PAGE_WALL_RECURRING_MIGRATION_NAME = 'page_wall_recurring_schedule_rules'

export function applyPageWallRecurringMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const exists = client.prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?')
      .get(PAGE_WALL_RECURRING_SCHEMA_VERSION)
    if (exists) return

    client.exec(`
      CREATE TABLE IF NOT EXISTS page_wall_recurring_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        page_tab_id INTEGER NOT NULL UNIQUE REFERENCES page_tabs(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 1,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        source_json TEXT NOT NULL,
        schedules_json TEXT NOT NULL,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_page_wall_recurring_enabled
        ON page_wall_recurring_plans(enabled, page_tab_id);

      CREATE TABLE IF NOT EXISTS page_wall_recurring_occurrences (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        plan_id INTEGER NOT NULL REFERENCES page_wall_recurring_plans(id) ON DELETE CASCADE,
        occurrence_key TEXT NOT NULL,
        job_id INTEGER REFERENCES page_wall_jobs(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(plan_id, occurrence_key)
      );

      CREATE INDEX IF NOT EXISTS idx_page_wall_recurring_occurrence_job
        ON page_wall_recurring_occurrences(job_id);
    `)

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(PAGE_WALL_RECURRING_SCHEMA_VERSION, PAGE_WALL_RECURRING_MIGRATION_NAME, Date.now())
  })

  migrate()
}
