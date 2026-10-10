import type Database from 'better-sqlite3'

export const PAGE_WALL_WEEKLY_SCHEDULE_SCHEMA_VERSION = 27
export const PAGE_WALL_WEEKLY_SCHEDULE_MIGRATION_NAME = 'page_wall_weekly_schedule'

export function applyPageWallWeeklyScheduleMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const applied = client
      .prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?')
      .get(PAGE_WALL_WEEKLY_SCHEDULE_SCHEMA_VERSION)
    if (applied) return

    client.exec(`
      CREATE TABLE IF NOT EXISTS page_wall_plan_weekdays (
        plan_id INTEGER NOT NULL REFERENCES page_wall_plans(id) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        PRIMARY KEY (plan_id, day_of_week)
      );

      CREATE INDEX IF NOT EXISTS idx_page_wall_plan_weekdays_day
        ON page_wall_plan_weekdays(day_of_week, plan_id);
    `)

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(PAGE_WALL_WEEKLY_SCHEDULE_SCHEMA_VERSION, PAGE_WALL_WEEKLY_SCHEDULE_MIGRATION_NAME, Date.now())
  })

  migrate()
}
