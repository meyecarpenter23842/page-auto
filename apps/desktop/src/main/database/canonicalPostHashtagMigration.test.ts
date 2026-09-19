import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  CANONICAL_POST_HASHTAG_MIGRATION_NAME,
  CANONICAL_POST_HASHTAG_SCHEMA_VERSION,
  applyCanonicalPostHashtagMigration
} from './canonicalPostHashtagMigration'

describe('canonical post hashtag migration', () => {
  it('creates companion metadata tables exactly once without altering core post/job columns', () => {
    const client = new Database(':memory:')
    client.pragma('foreign_keys = ON')
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

    applyCanonicalPostHashtagMigration(client)
    applyCanonicalPostHashtagMigration(client)

    const migration = client.prepare(
      'SELECT version, name FROM __page_auto_migrations WHERE version = ?'
    ).get(CANONICAL_POST_HASHTAG_SCHEMA_VERSION)
    const postHashtagTable = client.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'post_hashtags'"
    ).get()
    const jobHashtagTable = client.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'page_wall_job_hashtags'"
    ).get()
    const postColumns = client.prepare('PRAGMA table_info(posts)').all() as Array<{ name: string }>
    const jobColumns = client.prepare('PRAGMA table_info(page_wall_jobs)').all() as Array<{ name: string }>

    expect(migration).toEqual({
      version: CANONICAL_POST_HASHTAG_SCHEMA_VERSION,
      name: CANONICAL_POST_HASHTAG_MIGRATION_NAME
    })
    expect(postHashtagTable).toBeTruthy()
    expect(jobHashtagTable).toBeTruthy()
    expect(postColumns.map((column) => column.name)).not.toContain('hashtags')
    expect(jobColumns.map((column) => column.name)).not.toContain('hashtags')
    client.close()
  })
})
