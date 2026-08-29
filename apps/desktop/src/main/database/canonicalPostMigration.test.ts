import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  applyCanonicalPostMigration,
  CANONICAL_POST_MIGRATION_NAME,
  CANONICAL_POST_SCHEMA_VERSION
} from './canonicalPostMigration'

function createV13Database(): Database.Database {
  const client = new Database(':memory:')
  client.pragma('foreign_keys = ON')
  client.exec(`
    CREATE TABLE __page_auto_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE page_tabs (
      id INTEGER PRIMARY KEY NOT NULL,
      post_selection_mode TEXT NOT NULL DEFAULT 'sequential'
    );

    CREATE TABLE content_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      page_tab_id INTEGER UNIQUE REFERENCES page_tabs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'sequential',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE content_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      content_set_id INTEGER NOT NULL REFERENCES content_sets(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
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

    CREATE TABLE image_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      page_tab_id INTEGER NOT NULL UNIQUE REFERENCES page_tabs(id) ON DELETE CASCADE,
      folder_path TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'sequential',
      images_per_post INTEGER NOT NULL DEFAULT 1,
      missing_policy TEXT NOT NULL DEFAULT 'text_only',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE page_tab_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      page_tab_id INTEGER NOT NULL REFERENCES page_tabs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      variants_json TEXT NOT NULL,
      image_folder_path TEXT NOT NULL DEFAULT '',
      image_mode TEXT NOT NULL DEFAULT 'random',
      images_per_post INTEGER NOT NULL DEFAULT 1,
      missing_policy TEXT NOT NULL DEFAULT 'text_only',
      sort_order INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE scenarios (
      id INTEGER PRIMARY KEY NOT NULL
    );

    CREATE TABLE scenario_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      label TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      order_index INTEGER NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  return client
}

describe('Issue #188 canonical post migration', () => {
  it('backfills global content items once and reuses their canonical identities in Scenario post bindings', () => {
    const client = createV13Database()
    client.exec(`
      INSERT INTO content_sets (id, page_tab_id, name, mode, created_at, updated_at)
      VALUES (1, NULL, 'Library A', 'sequential', 100, 110);

      INSERT INTO content_items (
        id, content_set_id, name, enabled, content, variants_json,
        image_folder_path, image_mode, images_per_post, missing_policy,
        sort_order, created_at, updated_at
      ) VALUES
        (10, 1, 'Post A', 1, 'legacy A', '["A","A alt"]', 'C:/a', 'sequential', 2, 'text_only', 0, 101, 111),
        (11, 1, 'Post B', 0, 'legacy B', '[]', '', 'random', 1, 'skip', 1, 102, 112);

      INSERT INTO scenarios (id) VALUES (5);
    `)
    client.prepare(`
      INSERT INTO scenario_actions (
        id, scenario_id, action_type, label, category, order_index,
        config_json, enabled, created_at, updated_at
      ) VALUES (50, 5, 'post', 'Đăng bài', 'publishing', 0, ?, 1, 120, 130)
    `).run(JSON.stringify({ contentSetId: 1, selectionMode: 'random' }))

    applyCanonicalPostMigration(client)
    applyCanonicalPostMigration(client)

    const collectionPosts = client.prepare(`
      SELECT pcb.post_id AS postId, pcb.enabled, pcb.sort_order AS sortOrder
      FROM post_collection_bindings pcb
      JOIN post_collection_legacy_sources legacy ON legacy.collection_id = pcb.collection_id
      WHERE legacy.content_set_id = 1
      ORDER BY pcb.sort_order
    `).all()
    const scenarioPosts = client.prepare(`
      SELECT post_id AS postId, enabled, sort_order AS sortOrder
      FROM scenario_action_post_bindings
      WHERE scenario_action_id = 50
      ORDER BY sort_order
    `).all()
    const posts = client.prepare(`
      SELECT name, variants_json AS variantsJson, image_folder_path AS imageFolderPath,
             image_mode AS imageMode, images_per_post AS imagesPerPost, missing_policy AS missingPolicy
      FROM posts
      ORDER BY id
    `).all()
    const legacyCount = client.prepare('SELECT COUNT(*) AS count FROM content_items').get() as { count: number }
    const migration = client.prepare('SELECT version, name FROM __page_auto_migrations WHERE version = ?')
      .get(CANONICAL_POST_SCHEMA_VERSION)

    expect(collectionPosts).toEqual(scenarioPosts)
    expect(posts).toEqual([
      {
        name: 'Post A',
        variantsJson: '["A","A alt"]',
        imageFolderPath: 'C:/a',
        imageMode: 'sequential',
        imagesPerPost: 2,
        missingPolicy: 'text_only'
      },
      {
        name: 'Post B',
        variantsJson: '["legacy B"]',
        imageFolderPath: '',
        imageMode: 'random',
        imagesPerPost: 1,
        missingPolicy: 'skip'
      }
    ])
    expect(legacyCount.count).toBe(2)
    expect(migration).toEqual({
      version: CANONICAL_POST_SCHEMA_VERSION,
      name: CANONICAL_POST_MIGRATION_NAME
    })

    client.close()
  })

  it('prefers page_tab_posts over its legacy content/image mirror so Page data is not duplicated', () => {
    const client = createV13Database()
    client.exec(`
      INSERT INTO page_tabs (id, post_selection_mode) VALUES (7, 'random');
      INSERT INTO content_sets (id, page_tab_id, name, mode, created_at, updated_at)
      VALUES (3, 7, 'Legacy Page Content', 'sequential', 100, 100);
      INSERT INTO content_items (id, content_set_id, content, sort_order)
      VALUES (9, 3, 'mirror only', 0);
      INSERT INTO image_sources (
        page_tab_id, folder_path, mode, images_per_post, missing_policy, created_at, updated_at
      ) VALUES (7, 'C:/mirror', 'sequential', 1, 'text_only', 100, 100);
      INSERT INTO page_tab_posts (
        id, page_tab_id, name, enabled, variants_json,
        image_folder_path, image_mode, images_per_post, missing_policy,
        sort_order, created_at, updated_at
      ) VALUES (20, 7, 'Page Post', 1, '["primary","alt"]', 'C:/real', 'filename_match', 3, 'skip', 0, 200, 210);
    `)

    applyCanonicalPostMigration(client)

    const posts = client.prepare(`
      SELECT p.name, p.variants_json AS variantsJson, p.image_folder_path AS imageFolderPath,
             p.image_mode AS imageMode, p.images_per_post AS imagesPerPost, p.missing_policy AS missingPolicy,
             legacy.source_kind AS sourceKind, legacy.source_id AS sourceId
      FROM posts p
      JOIN post_legacy_sources legacy ON legacy.post_id = p.id
      ORDER BY p.id
    `).all()
    const bindingCount = client.prepare(`
      SELECT COUNT(*) AS count FROM page_tab_post_bindings WHERE page_tab_id = 7
    `).get() as { count: number }
    const mirroredSourceCount = client.prepare(`
      SELECT COUNT(*) AS count FROM post_legacy_sources
      WHERE source_kind = 'content_item' AND source_id = 9
    `).get() as { count: number }

    expect(posts).toEqual([{
      name: 'Page Post',
      variantsJson: '["primary","alt"]',
      imageFolderPath: 'C:/real',
      imageMode: 'filename_match',
      imagesPerPost: 3,
      missingPolicy: 'skip',
      sourceKind: 'page_tab_post',
      sourceId: 20
    }])
    expect(bindingCount.count).toBe(1)
    expect(mirroredSourceCount.count).toBe(0)

    client.close()
  })

  it('falls back to legacy Page content, preserves its selection/image config, and migrates inline group_post', () => {
    const client = createV13Database()
    client.exec(`
      INSERT INTO page_tabs (id, post_selection_mode) VALUES (8, 'sequential');
      INSERT INTO content_sets (id, page_tab_id, name, mode, created_at, updated_at)
      VALUES (4, 8, 'Old Page', 'random', 300, 310);
      INSERT INTO content_items (id, content_set_id, content, sort_order)
      VALUES (12, 4, 'legacy page body', 0);
      INSERT INTO image_sources (
        page_tab_id, folder_path, mode, images_per_post, missing_policy, created_at, updated_at
      ) VALUES (8, 'C:/legacy-page', 'filename_match', 4, 'skip', 300, 310);
      INSERT INTO scenarios (id) VALUES (6);
    `)
    client.prepare(`
      INSERT INTO scenario_actions (
        id, scenario_id, action_type, label, category, order_index,
        config_json, enabled, created_at, updated_at
      ) VALUES (60, 6, 'group_post', 'Nhóm cũ', 'groups', 0, ?, 1, 400, 410)
    `).run(JSON.stringify({
      sourceTargets: '123',
      content: 'one\\|literal|two',
      postMode: 'random',
      imageFolderPath: 'C:/scenario',
      imageMode: 'random',
      imagesPerPost: 2,
      missingPolicy: 'text_only'
    }))

    applyCanonicalPostMigration(client)

    const page = client.prepare(`
      SELECT p.variants_json AS variantsJson, p.image_folder_path AS imageFolderPath,
             p.image_mode AS imageMode, p.images_per_post AS imagesPerPost, p.missing_policy AS missingPolicy
      FROM page_tab_post_bindings b
      JOIN posts p ON p.id = b.post_id
      WHERE b.page_tab_id = 8
    `).get()
    const pageMode = client.prepare('SELECT post_selection_mode AS mode FROM page_tabs WHERE id = 8').get()
    const scenario = client.prepare(`
      SELECT p.id, p.variants_json AS variantsJson, p.image_folder_path AS imageFolderPath,
             p.image_mode AS imageMode, p.images_per_post AS imagesPerPost
      FROM scenario_action_post_bindings b
      JOIN posts p ON p.id = b.post_id
      WHERE b.scenario_action_id = 60
    `).get() as Record<string, unknown>

    expect(page).toEqual({
      variantsJson: '["legacy page body"]',
      imageFolderPath: 'C:/legacy-page',
      imageMode: 'filename_match',
      imagesPerPost: 4,
      missingPolicy: 'skip'
    })
    expect(pageMode).toEqual({ mode: 'random' })
    expect(scenario).toMatchObject({
      variantsJson: '["one|literal","two"]',
      imageFolderPath: 'C:/scenario',
      imageMode: 'random',
      imagesPerPost: 2
    })
    expect(() => client.prepare('DELETE FROM posts WHERE id = ?').run(Number(scenario.id))).toThrow()

    client.close()
  })
})
