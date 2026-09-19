import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from './index'
import { CanonicalPostRepository } from './canonicalPostRepository'
import { CanonicalPostHashtagRepository } from './canonicalPostHashtagRepository'

const directories: string[] = []
const runtimes: ReturnType<typeof initializeDatabase>[] = []

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('CanonicalPostHashtagRepository', () => {
  it('stores metadata outside posts and cascades it with canonical deletion', () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-auto-post-hashtags-'))
    directories.push(directory)
    const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
    runtimes.push(runtime)

    const posts = new CanonicalPostRepository(runtime.client)
    const hashtags = new CanonicalPostHashtagRepository(runtime.client)
    const post = posts.create({
      name: 'Bài hashtag',
      variants: ['Nội dung'],
      image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
    }, 1000)

    expect(hashtags.set(post.id, '  {#sale|#hot} #PageAuto  ', 1100)).toBe('{#sale|#hot} #PageAuto')
    expect(hashtags.get(post.id)).toBe('{#sale|#hot} #PageAuto')
    expect(hashtags.getMany([post.id, post.id])).toEqual(new Map([[post.id, '{#sale|#hot} #PageAuto']]))

    expect(runtime.client.prepare('PRAGMA table_info(posts)').all())
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'hashtags' })]))

    hashtags.set(post.id, '', 1200)
    expect(hashtags.get(post.id)).toBe('')

    hashtags.set(post.id, '#BillMafia', 1300)
    posts.delete(post.id)
    expect(runtime.client.prepare('SELECT * FROM post_hashtags WHERE post_id = ?').all(post.id)).toEqual([])
  })
})
