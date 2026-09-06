import type Database from 'better-sqlite3'

export const ACTION_WORKSPACE_PRESET_SCHEMA_VERSION = 24
export const ACTION_WORKSPACE_PRESET_MIGRATION_NAME = 'action_workspace_presets'

export function applyActionWorkspacePresetMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const exists = client
      .prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?')
      .get(ACTION_WORKSPACE_PRESET_SCHEMA_VERSION)
    if (exists) return

    client.exec(`
      CREATE TABLE IF NOT EXISTS action_workspace_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        workspace_type TEXT NOT NULL,
        name TEXT NOT NULL,
        config_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(workspace_type, name)
      );

      CREATE INDEX IF NOT EXISTS idx_action_workspace_presets_type_name
        ON action_workspace_presets(workspace_type, name COLLATE NOCASE, id);
    `)

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(ACTION_WORKSPACE_PRESET_SCHEMA_VERSION, ACTION_WORKSPACE_PRESET_MIGRATION_NAME, Date.now())
  })

  migrate()
}
