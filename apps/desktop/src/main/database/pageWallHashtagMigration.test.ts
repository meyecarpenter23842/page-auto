import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { applyPageWallHashtagMigration } from './pageWallHashtagMigration'

describe('Page Wall separate hashtag migration', () => {
  it('adds optional hashtag storage to canonical posts and Page Wall jobs exactly once', () => {
    const client = new Database(':memory:')
    client.exec(`
      CREATE TABLE __page_auto_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE page_wall_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        content TEXT NOT NULL DEFAULT ''
      );
    `)

    applyPageWallHashtagMigration(client)
    applyPageWallHashtagMigration(client)

    const postColumns = client.prepare('PRAGMA table_info(posts)').all() as Array<{ name: string; dflt_value: string | null }>
    const jobColumns = client.prepare('PRAGMA table_info(page_wall_jobs)').all() as Array<{ name: string; dflt_value: string | null }>
    const migration = client.prepare('SELECT version, name FROM __page_auto_migrations WHERE version = 31').get()

    expect(postColumns.find((column) => column.name === 'hashtags')?.dflt_value).toBe("''")
    expect(jobColumns.find((column) => column.name === 'hashtags')?.dflt_value).toBe("''")
    expect(migration).toEqual({ version: 31, name: 'page_wall_separate_hashtags' })
    client.close()
  })
})
