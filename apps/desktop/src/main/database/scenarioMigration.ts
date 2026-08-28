import type Database from 'better-sqlite3'

export const SCENARIO_SCHEMA_VERSION = 11
export const SCENARIO_MIGRATION_NAME = 'scenario_shell'

export function applyScenarioMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const exists = client.prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?').get(SCENARIO_SCHEMA_VERSION)
    if (exists) return

    client.exec(`
      CREATE TABLE IF NOT EXISTS scenarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        name TEXT NOT NULL,
        random_action_order INTEGER NOT NULL DEFAULT 0 CHECK (random_action_order IN (0, 1)),
        runtime_limit_minutes INTEGER CHECK (runtime_limit_minutes IS NULL OR runtime_limit_minutes > 0),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scenarios_updated
        ON scenarios(updated_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS scenario_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
        action_type TEXT NOT NULL,
        label TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'other',
        order_index INTEGER NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scenario_actions_order
        ON scenario_actions(scenario_id, order_index, id);
    `)

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(SCENARIO_SCHEMA_VERSION, SCENARIO_MIGRATION_NAME, Date.now())
  })

  migrate()
}
