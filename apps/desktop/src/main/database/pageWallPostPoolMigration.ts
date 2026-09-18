import type Database from 'better-sqlite3'

export const PAGE_WALL_POST_POOL_SCHEMA_VERSION = 30
export const PAGE_WALL_POST_POOL_MIGRATION_NAME = 'page_wall_schedule_post_pool'

export function applyPageWallPostPoolMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const applied = client
      .prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?')
      .get(PAGE_WALL_POST_POOL_SCHEMA_VERSION)
    if (applied) return

    client.exec(`
      CREATE TABLE IF NOT EXISTS page_wall_schedule_post_pools (
        plan_id INTEGER PRIMARY KEY NOT NULL REFERENCES page_wall_plans(id) ON DELETE CASCADE,
        group_key TEXT NOT NULL,
        selection_mode TEXT NOT NULL CHECK (selection_mode IN ('sequential', 'random')),
        slot_order INTEGER NOT NULL CHECK (slot_order >= 0),
        posts_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_page_wall_schedule_post_pools_group
        ON page_wall_schedule_post_pools(group_key, slot_order, plan_id);
    `)

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(PAGE_WALL_POST_POOL_SCHEMA_VERSION, PAGE_WALL_POST_POOL_MIGRATION_NAME, Date.now())
  })

  migrate()
}
