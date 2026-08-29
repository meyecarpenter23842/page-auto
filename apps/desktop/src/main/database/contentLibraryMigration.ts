import type Database from 'better-sqlite3'

export const CONTENT_LIBRARY_SCHEMA_VERSION = 13
export const CONTENT_LIBRARY_MIGRATION_NAME = 'global_content_library'

export function applyContentLibraryMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const exists = client.prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?').get(CONTENT_LIBRARY_SCHEMA_VERSION)
    if (exists) return

    client.exec(`
      CREATE TABLE content_sets_k451 (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        page_tab_id INTEGER UNIQUE REFERENCES page_tabs(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'sequential',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO content_sets_k451 (id, page_tab_id, name, mode, created_at, updated_at)
      SELECT id, page_tab_id, name, mode, created_at, updated_at
      FROM content_sets;

      CREATE TABLE content_items_k451 (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        content_set_id INTEGER NOT NULL REFERENCES content_sets_k451(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        content TEXT NOT NULL DEFAULT '',
        variants_json TEXT NOT NULL DEFAULT '[]',
        image_folder_path TEXT NOT NULL DEFAULT '',
        image_mode TEXT NOT NULL DEFAULT 'random',
        images_per_post INTEGER NOT NULL DEFAULT 1,
        missing_policy TEXT NOT NULL DEFAULT 'text_only',
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );

      INSERT INTO content_items_k451 (
        id, content_set_id, name, enabled, content, variants_json,
        image_folder_path, image_mode, images_per_post, missing_policy,
        sort_order, created_at, updated_at
      )
      SELECT
        id,
        content_set_id,
        '',
        1,
        content,
        '[]',
        '',
        'random',
        1,
        'text_only',
        sort_order,
        0,
        0
      FROM content_items;

      DROP TABLE content_items;
      DROP TABLE content_sets;
      ALTER TABLE content_sets_k451 RENAME TO content_sets;
      ALTER TABLE content_items_k451 RENAME TO content_items;

      CREATE INDEX IF NOT EXISTS idx_content_items_order
        ON content_items(content_set_id, sort_order, id);
      CREATE INDEX IF NOT EXISTS idx_content_sets_global_updated
        ON content_sets(page_tab_id, updated_at DESC, id DESC);
    `)

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(CONTENT_LIBRARY_SCHEMA_VERSION, CONTENT_LIBRARY_MIGRATION_NAME, Date.now())
  })

  migrate()
}
