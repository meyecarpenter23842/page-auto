import type Database from 'better-sqlite3'

export const COPY_POST_SCHEMA_VERSION = 15
export const COPY_POST_MIGRATION_NAME = 'copy_post_history'

export function applyCopyPostMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const exists = client.prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?').get(COPY_POST_SCHEMA_VERSION)
    if (exists) return

    client.exec(`
      CREATE TABLE copy_post_history (
        source_post_id TEXT PRIMARY KEY NOT NULL,
        source TEXT NOT NULL,
        permalink TEXT NOT NULL DEFAULT '',
        canonical_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
        media_folder_path TEXT NOT NULL DEFAULT '',
        saved_at INTEGER NOT NULL
      );

      CREATE INDEX idx_copy_post_history_saved_at
        ON copy_post_history(saved_at DESC);

      CREATE TABLE post_media_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
        file_path TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(post_id, sort_order)
      );

      CREATE INDEX idx_post_media_assets_post
        ON post_media_assets(post_id, sort_order);
    `)

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(COPY_POST_SCHEMA_VERSION, COPY_POST_MIGRATION_NAME, Date.now())
  })

  migrate()
}
