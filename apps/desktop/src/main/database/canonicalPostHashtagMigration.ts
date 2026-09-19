import type Database from 'better-sqlite3'

export const CANONICAL_POST_HASHTAG_SCHEMA_VERSION = 31
export const CANONICAL_POST_HASHTAG_MIGRATION_NAME = 'canonical_post_hashtags'

export function applyCanonicalPostHashtagMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const applied = client
      .prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?')
      .get(CANONICAL_POST_HASHTAG_SCHEMA_VERSION)
    if (applied) return

    client.exec(`
      CREATE TABLE IF NOT EXISTS post_hashtags (
        post_id INTEGER PRIMARY KEY NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        source TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS page_wall_job_hashtags (
        job_id INTEGER PRIMARY KEY NOT NULL REFERENCES page_wall_jobs(id) ON DELETE CASCADE,
        source TEXT NOT NULL DEFAULT ''
      );
    `)

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(
      CANONICAL_POST_HASHTAG_SCHEMA_VERSION,
      CANONICAL_POST_HASHTAG_MIGRATION_NAME,
      Date.now()
    )
  })

  migrate()
}
