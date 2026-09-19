import type Database from 'better-sqlite3'

const MAX_HASHTAG_SOURCE_LENGTH = 2_000

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} không hợp lệ.`)
  return value
}

export function normalizeCanonicalPostHashtags(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim()
  if (normalized.length > MAX_HASHTAG_SOURCE_LENGTH) {
    throw new Error('Hashtag cuối bài tối đa 2000 ký tự.')
  }
  return normalized
}

export class CanonicalPostHashtagRepository {
  constructor(private readonly client: Database.Database) {}

  get(postId: number): string {
    const id = positiveId(postId, 'Post ID')
    const row = this.client.prepare(
      'SELECT source FROM post_hashtags WHERE post_id = ?'
    ).get(id) as { source: string } | undefined
    return normalizeCanonicalPostHashtags(row?.source)
  }

  getMany(postIds: readonly number[]): Map<number, string> {
    const ids = [...new Set(postIds.filter((value) => Number.isSafeInteger(value) && value > 0))]
    if (!ids.length) return new Map()
    const placeholders = ids.map(() => '?').join(', ')
    const rows = this.client.prepare(
      `SELECT post_id AS postId, source FROM post_hashtags WHERE post_id IN (${placeholders})`
    ).all(...ids) as Array<{ postId: number; source: string }>
    return new Map(rows.map((row) => [Number(row.postId), normalizeCanonicalPostHashtags(row.source)]))
  }

  set(postId: number, value: string | null | undefined, now = Date.now()): string {
    const id = positiveId(postId, 'Post ID')
    const source = normalizeCanonicalPostHashtags(value)
    if (!source) {
      this.client.prepare('DELETE FROM post_hashtags WHERE post_id = ?').run(id)
      return ''
    }
    this.client.prepare(`
      INSERT INTO post_hashtags (post_id, source, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(post_id) DO UPDATE SET source = excluded.source, updated_at = excluded.updated_at
    `).run(id, source, now)
    return source
  }
}
