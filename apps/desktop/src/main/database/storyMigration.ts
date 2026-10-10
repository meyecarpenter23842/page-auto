import type Database from 'better-sqlite3'

export const STORY_SCHEMA_VERSION = 17
export const STORY_MIGRATION_NAME = 'story_library'

export function applyStoryMigration(db: Database.Database) {
  const migrate = db.transaction(() => {
    const exists = db.prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?').get(STORY_SCHEMA_VERSION)
    if (exists) return

    db.exec(`
      CREATE TABLE IF NOT EXISTS story_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        media_source_type TEXT NOT NULL DEFAULT 'none',
        media_path TEXT NOT NULL DEFAULT '',
        media_kind TEXT NOT NULL DEFAULT 'auto',
        folder_mode TEXT NOT NULL DEFAULT 'sequential',
        link_url TEXT NOT NULL DEFAULT '',
        random_background INTEGER NOT NULL DEFAULT 1,
        random_font INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_story_items_updated
        ON story_items(updated_at DESC, id DESC);
    `)
    db.prepare(`
      INSERT INTO __page_auto_migrations(version, name, applied_at)
      VALUES (?, ?, ?)
    `).run(STORY_SCHEMA_VERSION, STORY_MIGRATION_NAME, Date.now())
  })

  migrate()
}
