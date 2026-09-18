import type Database from 'better-sqlite3'

export const ZALO_POST_BINDING_SCHEMA_VERSION = 29
export const ZALO_POST_BINDING_MIGRATION_NAME = 'zalo_post_bindings'

export function applyZaloPostBindingMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const applied = client
      .prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?')
      .get(ZALO_POST_BINDING_SCHEMA_VERSION)
    if (applied) return

    client.exec(`
      CREATE TABLE IF NOT EXISTS zalo_automation_config (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
        post_selection_mode TEXT NOT NULL DEFAULT 'sequential',
        updated_at INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO zalo_automation_config (id, post_selection_mode, updated_at)
      VALUES (1, 'sequential', 0);

      CREATE TABLE IF NOT EXISTS zalo_post_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        config_id INTEGER NOT NULL DEFAULT 1 REFERENCES zalo_automation_config(id) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE RESTRICT,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        sort_order INTEGER NOT NULL,
        name_override TEXT,
        variants_override_json TEXT,
        image_folder_path_override TEXT,
        image_mode_override TEXT,
        images_per_post_override INTEGER CHECK (images_per_post_override IS NULL OR images_per_post_override > 0),
        missing_policy_override TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(config_id, post_id)
      );

      CREATE INDEX IF NOT EXISTS idx_zalo_post_bindings_order
        ON zalo_post_bindings(config_id, sort_order, id);
    `)

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(ZALO_POST_BINDING_SCHEMA_VERSION, ZALO_POST_BINDING_MIGRATION_NAME, Date.now())
  })

  migrate()
}
