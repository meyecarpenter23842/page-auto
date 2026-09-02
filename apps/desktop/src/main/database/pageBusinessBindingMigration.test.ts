import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { applyPageBusinessBindingMigration, PAGE_BUSINESS_BINDING_SCHEMA_VERSION } from './pageBusinessBindingMigration'

function runtime() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE __page_auto_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);
    CREATE TABLE page_tabs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE action_workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_type TEXT NOT NULL,
      label TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  return db
}

describe('Page business explicit binding migration', () => {
  it('backfills existing Page businesses once but never auto-binds Pages created later', () => {
    const db = runtime()
    try {
      db.prepare('INSERT INTO page_tabs (name) VALUES (?)').run('Page A')
      db.prepare('INSERT INTO page_tabs (name) VALUES (?)').run('Page B')
      db.prepare(`INSERT INTO action_workspaces (workspace_type, label, config_json, created_at, updated_at) VALUES ('group', ?, ?, 1, 1)`)
        .run('Page A · Tham gia nhóm', JSON.stringify({ pageTabId: 1, sourceMode: 'id_shared' }))

      applyPageBusinessBindingMigration(db)

      const rows = db.prepare('SELECT workspace_type AS type, label, config_json AS configJson FROM action_workspaces ORDER BY id').all() as Array<{ type: string; label: string; configJson: string }>
      const generic = rows.map((row) => {
        try { return JSON.parse(row.configJson) as Record<string, unknown> } catch { return {} }
      }).filter((raw) => raw.pageBusinessType)
      expect(generic).toHaveLength(6)
      expect(generic.filter((raw) => raw.pageBusinessType === 'group_post')).toHaveLength(2)
      expect(generic.filter((raw) => raw.pageBusinessType === 'page_wall_post')).toHaveLength(2)
      expect(generic.filter((raw) => raw.pageBusinessType === 'page_edit')).toHaveLength(2)
      expect(rows.some((row) => row.type === 'group' && row.label.includes('Tham gia nhóm'))).toBe(true)
      expect(db.prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?').get(PAGE_BUSINESS_BINDING_SCHEMA_VERSION)).toBeTruthy()

      db.prepare('INSERT INTO page_tabs (name) VALUES (?)').run('Page C')
      applyPageBusinessBindingMigration(db)
      const pageCBindings = (db.prepare('SELECT config_json AS configJson FROM action_workspaces').all() as Array<{ configJson: string }>)
        .map((row) => { try { return JSON.parse(row.configJson) as Record<string, unknown> } catch { return {} } })
        .filter((raw) => raw.pageTabId === 3 && raw.pageBusinessType)
      expect(pageCBindings).toHaveLength(0)
    } finally {
      db.close()
    }
  })
})
