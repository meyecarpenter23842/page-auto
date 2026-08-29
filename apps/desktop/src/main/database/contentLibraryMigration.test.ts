import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { applyContentLibraryMigration } from './contentLibraryMigration'

describe('K4.5.1 content library migration', () => {
  it('preserves v12 Page Tab content while making global content_sets possible', () => {
    const client = new Database(':memory:')
    client.pragma('foreign_keys = ON')
    client.exec(`
      CREATE TABLE __page_auto_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE page_tabs (
        id INTEGER PRIMARY KEY NOT NULL
      );
      CREATE TABLE content_sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        page_tab_id INTEGER NOT NULL UNIQUE REFERENCES page_tabs(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'sequential',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE content_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        content_set_id INTEGER NOT NULL REFERENCES content_sets(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        sort_order INTEGER NOT NULL
      );
      INSERT INTO page_tabs (id) VALUES (7);
      INSERT INTO content_sets (id, page_tab_id, name, mode, created_at, updated_at)
        VALUES (3, 7, 'Legacy content', 'sequential', 100, 100);
      INSERT INTO content_items (id, content_set_id, content, sort_order)
        VALUES (9, 3, 'legacy A', 0), (10, 3, 'legacy B', 1);
    `)

    applyContentLibraryMigration(client)
    applyContentLibraryMigration(client)

    const legacySet = client.prepare('SELECT id, page_tab_id AS pageTabId FROM content_sets WHERE id = 3').get() as { id: number; pageTabId: number | null }
    const legacyItems = client.prepare('SELECT id, content, variants_json AS variantsJson FROM content_items WHERE content_set_id = 3 ORDER BY sort_order').all()
    const globalInsert = client.prepare(`
      INSERT INTO content_sets (page_tab_id, name, mode, created_at, updated_at)
      VALUES (NULL, 'Global A', 'sequential', 200, 200), (NULL, 'Global B', 'sequential', 200, 200)
    `).run()
    const migration = client.prepare('SELECT version, name FROM __page_auto_migrations WHERE version = 13').get()

    expect(legacySet).toEqual({ id: 3, pageTabId: 7 })
    expect(legacyItems).toEqual([
      { id: 9, content: 'legacy A', variantsJson: '[]' },
      { id: 10, content: 'legacy B', variantsJson: '[]' }
    ])
    expect(globalInsert.changes).toBe(2)
    expect(migration).toEqual({ version: 13, name: 'global_content_library' })

    client.close()
  })
})
