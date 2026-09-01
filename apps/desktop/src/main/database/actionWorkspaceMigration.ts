import type Database from 'better-sqlite3'

export const ACTION_WORKSPACE_SCHEMA_VERSION = 18
export const ACTION_WORKSPACE_MIGRATION_NAME = 'action_workspace_persistence'

export function applyActionWorkspaceMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const exists = client
      .prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?')
      .get(ACTION_WORKSPACE_SCHEMA_VERSION)
    if (exists) return

    client.exec(`
      CREATE TABLE IF NOT EXISTS action_workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        workspace_type TEXT NOT NULL,
        label TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_action_workspaces_updated
        ON action_workspaces(updated_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS action_workspace_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        workspace_id INTEGER NOT NULL REFERENCES action_workspaces(id) ON DELETE CASCADE,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        UNIQUE(workspace_id, account_id)
      );

      CREATE INDEX IF NOT EXISTS idx_action_workspace_accounts_order
        ON action_workspace_accounts(workspace_id, sort_order, id);
    `)

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(ACTION_WORKSPACE_SCHEMA_VERSION, ACTION_WORKSPACE_MIGRATION_NAME, Date.now())
  })

  migrate()
}
