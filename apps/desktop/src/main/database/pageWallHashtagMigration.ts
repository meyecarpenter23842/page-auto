import type Database from 'better-sqlite3'

export const PAGE_WALL_HASHTAG_SCHEMA_VERSION = 31
export const PAGE_WALL_HASHTAG_MIGRATION_NAME = 'page_wall_separate_hashtags'

export function applyPageWallHashtagMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const applied = client
      .prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?')
      .get(PAGE_WALL_HASHTAG_SCHEMA_VERSION)
    if (applied) return

    client.exec(`
      ALTER TABLE posts ADD COLUMN hashtags TEXT NOT NULL DEFAULT '';
      ALTER TABLE page_wall_jobs ADD COLUMN hashtags TEXT NOT NULL DEFAULT '';
    `)

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(PAGE_WALL_HASHTAG_SCHEMA_VERSION, PAGE_WALL_HASHTAG_MIGRATION_NAME, Date.now())
  })

  migrate()
}
