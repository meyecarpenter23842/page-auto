import type Database from 'better-sqlite3'

/**
 * Issue #283 finite Wall-plan model.
 *
 * v21 `page_wall_recurring_*`, ActionWorkspace `wallSchedule` and existing one-shot
 * `page_wall_jobs` are intentionally left untouched for compatibility. The new model
 * owns durable plans + one finite occurrence per plan/local date, then links immutable
 * concrete `page_wall_jobs` through a relation table instead of altering legacy jobs.
 */
export const PAGE_WALL_FINITE_PLAN_SCHEMA_VERSION = 22
export const PAGE_WALL_FINITE_PLAN_MIGRATION_NAME = 'page_wall_finite_plans'

export function applyPageWallFinitePlanMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const exists = client.prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?')
      .get(PAGE_WALL_FINITE_PLAN_SCHEMA_VERSION)
    if (exists) return

    client.exec(`
      CREATE TABLE IF NOT EXISTS page_wall_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        page_tab_id INTEGER NOT NULL REFERENCES page_tabs(id) ON DELETE CASCADE,
        schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('specific_date', 'daily')),
        local_date TEXT,
        minute_of_day INTEGER NOT NULL CHECK (minute_of_day BETWEEN 0 AND 1439),
        account_concurrency INTEGER NOT NULL DEFAULT 1 CHECK (account_concurrency BETWEEN 1 AND 20),
        task_definitions_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'disabled', 'needs_attention')),
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (
          (schedule_kind = 'specific_date' AND local_date IS NOT NULL)
          OR (schedule_kind = 'daily' AND local_date IS NULL)
        )
      );

      CREATE INDEX IF NOT EXISTS idx_page_wall_plans_page
        ON page_wall_plans(page_tab_id, status, id);
      CREATE INDEX IF NOT EXISTS idx_page_wall_plans_schedule
        ON page_wall_plans(status, schedule_kind, local_date, minute_of_day, id);

      CREATE TABLE IF NOT EXISTS page_wall_plan_occurrences (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        plan_id INTEGER NOT NULL REFERENCES page_wall_plans(id) ON DELETE CASCADE,
        occurrence_key TEXT NOT NULL,
        local_date TEXT NOT NULL,
        scheduled_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (
          status IN ('pending', 'running', 'success', 'failed', 'needs_attention', 'cancelled')
        ),
        account_concurrency INTEGER NOT NULL CHECK (account_concurrency BETWEEN 1 AND 20),
        task_count INTEGER NOT NULL CHECK (task_count >= 0),
        result_message TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        updated_at INTEGER NOT NULL,
        UNIQUE(plan_id, occurrence_key),
        UNIQUE(plan_id, local_date)
      );

      CREATE INDEX IF NOT EXISTS idx_page_wall_plan_occurrences_plan
        ON page_wall_plan_occurrences(plan_id, local_date DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_page_wall_plan_occurrences_status
        ON page_wall_plan_occurrences(status, scheduled_at, id);

      CREATE TABLE IF NOT EXISTS page_wall_plan_occurrence_jobs (
        occurrence_id INTEGER NOT NULL REFERENCES page_wall_plan_occurrences(id) ON DELETE CASCADE,
        job_id INTEGER NOT NULL UNIQUE REFERENCES page_wall_jobs(id) ON DELETE CASCADE,
        task_order INTEGER NOT NULL CHECK (task_order >= 0),
        PRIMARY KEY (occurrence_id, task_order)
      );

      CREATE INDEX IF NOT EXISTS idx_page_wall_plan_occurrence_jobs_job
        ON page_wall_plan_occurrence_jobs(job_id);
    `)

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(PAGE_WALL_FINITE_PLAN_SCHEMA_VERSION, PAGE_WALL_FINITE_PLAN_MIGRATION_NAME, Date.now())
  })

  migrate()
}
