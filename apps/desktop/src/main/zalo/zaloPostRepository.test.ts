import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { applyZaloPostBindingMigration } from '../database/zaloPostBindingMigration'
import { ZaloPostRepository } from '../database/zaloPostRepository'

function openDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE __page_auto_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at INTEGER NOT NULL);
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      name TEXT NOT NULL,
      variants_json TEXT NOT NULL DEFAULT '[]',
      hashtags TEXT NOT NULL DEFAULT '',
      image_folder_path TEXT NOT NULL DEFAULT '',
      image_mode TEXT NOT NULL DEFAULT 'random',
      images_per_post INTEGER NOT NULL DEFAULT 1,
      missing_policy TEXT NOT NULL DEFAULT 'text_only',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  applyZaloPostBindingMigration(db)
  return db
}

describe('Zalo post consumer binding', () => {
  it('binds canonical posts, persists per-post media overrides and unlinks without deleting canonical', () => {
    const db = openDb()
    const now = Date.now()
    const postId = Number(db.prepare(`
      INSERT INTO posts (name, variants_json, image_folder_path, image_mode, images_per_post, missing_policy, created_at, updated_at)
      VALUES ('Bài A', '["A1","A2"]', 'D:/canonical', 'random', 2, 'text_only', ?, ?)
    `).run(now, now).lastInsertRowid)
    const repo = new ZaloPostRepository(db)

    let library = repo.save({
      mode: 'random',
      posts: [{
        postId, enabled: true, sortOrder: 0,
        media: { source: 'canonical', folderPath: '', mode: 'sequential', imagesPerTarget: 1, missingPolicy: 'text_only' }
      }]
    })
    expect(library.mode).toBe('random')
    expect(library.posts[0]).toMatchObject({
      postId, name: 'Bài A', variants: ['A1', 'A2'],
      media: { source: 'canonical', folderPath: 'D:/canonical', mode: 'random', imagesPerTarget: 2 }
    })

    library = repo.save({
      mode: 'sequential',
      posts: [{
        postId, enabled: true, sortOrder: 0,
        media: { source: 'folder', folderPath: 'D:/zalo-only', mode: 'sequential', imagesPerTarget: 3, missingPolicy: 'skip' }
      }]
    })
    expect(library.posts[0]?.media).toEqual({
      source: 'folder', folderPath: 'D:/zalo-only', mode: 'sequential', imagesPerTarget: 3, missingPolicy: 'skip'
    })

    library = repo.save({
      mode: 'sequential',
      posts: [{
        postId, enabled: true, sortOrder: 0,
        media: { source: 'none', folderPath: 'ignored', mode: 'random', imagesPerTarget: 4, missingPolicy: 'skip' }
      }]
    })
    expect(library.posts[0]?.media.source).toBe('none')
    expect(library.posts[0]?.media.folderPath).toBe('')

    repo.save({ mode: 'sequential', posts: [] })
    expect(repo.get().posts).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS count FROM posts WHERE id = ?').get(postId)).toEqual({ count: 1 })
    db.close()
  })
})
