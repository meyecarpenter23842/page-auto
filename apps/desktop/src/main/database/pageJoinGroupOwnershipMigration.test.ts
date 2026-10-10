import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { pageBusinessTypeOf } from '../../shared/pageBusinessBindings'
import { applyPageJoinGroupOwnershipRepair } from './pageJoinGroupOwnershipMigration'

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

describe('legacy Page Tham gia nhóm ownership repair', () => {
  it('marks only legacy Page-bound rows, leaves normal Group workspaces alone, and is idempotent', () => {
    const db = runtime()
    try {
      db.prepare('INSERT INTO page_tabs (name) VALUES (?)').run('Thông Chi')
      db.prepare(`INSERT INTO action_workspaces (workspace_type, label, config_json, created_at, updated_at) VALUES ('group', ?, ?, 1, 1)`)
        .run('Thông Chi · Tham gia nhóm', JSON.stringify({ pageTabId: 1, sourceMode: 'id_shared', sourceTargets: '10001' }))
      db.prepare(`INSERT INTO action_workspaces (workspace_type, label, config_json, created_at, updated_at) VALUES ('group', ?, ?, 1, 1)`)
        .run('Tham gia nhóm', JSON.stringify({ pageTabId: 1, sourceMode: 'id_shared', sourceTargets: '10002' }))
      db.prepare(`INSERT INTO action_workspaces (workspace_type, label, config_json, created_at, updated_at) VALUES ('group', ?, ?, 1, 1)`)
        .run('Page không tồn tại · Tham gia nhóm', JSON.stringify({ pageTabId: 999, sourceMode: 'id_shared' }))

      applyPageJoinGroupOwnershipRepair(db)

      const rows = db.prepare('SELECT id, workspace_type AS type, label, config_json AS configJson FROM action_workspaces ORDER BY id').all() as Array<{ id: number; type: 'group'; label: string; configJson: string }>
      const first = { ...rows[0]!, accounts: [], createdAt: 1, updatedAt: 1 }
      const second = { ...rows[1]!, accounts: [], createdAt: 1, updatedAt: 1 }
      expect(pageBusinessTypeOf(first)).toBe('join_group')
      expect(pageBusinessTypeOf(second)).toBeNull()
      expect(JSON.parse(rows[2]!.configJson).pageBusinessType).toBeUndefined()
      expect(db.prepare('SELECT COUNT(*) AS count FROM __page_auto_migrations').get()).toEqual({ count: 0 })

      const firstConfig = rows[0]!.configJson
      applyPageJoinGroupOwnershipRepair(db)
      expect((db.prepare('SELECT config_json AS configJson FROM action_workspaces WHERE id = 1').get() as { configJson: string }).configJson).toBe(firstConfig)
      expect(db.prepare('SELECT COUNT(*) AS count FROM __page_auto_migrations').get()).toEqual({ count: 0 })
    } finally {
      db.close()
    }
  })
})
