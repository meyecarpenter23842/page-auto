import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CANONICAL_CONTENT_LIBRARY_SET_ID } from '../../shared/contentLibrary'
import { initializeDatabase } from '../database'
import { CanonicalContentLibraryRepository } from './canonicalContentLibraryRepository'
import { ContentLibraryRepository } from './contentLibraryRepository'
import { PageTabPostRepository } from './pageTabPostRepository'
import { PageTabRepository } from './pageTabRepository'

const directories: string[] = []
const runtimes: ReturnType<typeof initializeDatabase>[] = []

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function runtime(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  directories.push(directory)
  const value = initializeDatabase(join(directory, 'page-auto.sqlite'))
  runtimes.push(value)
  return value
}

describe('canonical content library workspace adapter', () => {
  it('shows posts created inside a Page in the global canonical library', () => {
    const db = runtime('page-auto-canonical-library-page-')
    const page = new PageTabRepository(db.client).create({ name: 'Page A', pageUid: 'page-a' })

    new PageTabPostRepository(db.client).save({
      pageTabId: page.id,
      mode: 'sequential',
      posts: [{
        postId: null,
        name: 'Bài tạo từ Page',
        enabled: true,
        sortOrder: 0,
        variants: ['Nội dung nhìn thấy ở thư viện'],
        image: { folderPath: '', mode: 'random', imagesPerPost: 1, missingPolicy: 'text_only' }
      }]
    })

    const library = new CanonicalContentLibraryRepository(db.client).get()
    expect(library.id).toBe(CANONICAL_CONTENT_LIBRARY_SET_ID)
    expect(library.items).toHaveLength(1)
    expect(library.items[0]).toMatchObject({
      name: 'Bài tạo từ Page',
      variants: ['Nội dung nhìn thấy ở thư viện'],
      enabled: true
    })
    expect(library.items[0]!.id).toBeLessThan(0)
  })

  it('edits the canonical post from the global library and blocks deleting it while Page still uses it', () => {
    const db = runtime('page-auto-canonical-library-edit-')
    const page = new PageTabRepository(db.client).create({ name: 'Page A', pageUid: 'page-a' })
    const pagePosts = new PageTabPostRepository(db.client)
    const saved = pagePosts.save({
      pageTabId: page.id,
      mode: 'sequential',
      posts: [{
        postId: null,
        name: 'Bài gốc',
        enabled: true,
        sortOrder: 0,
        variants: ['Nội dung cũ'],
        image: { folderPath: '', mode: 'random', imagesPerPost: 1, missingPolicy: 'text_only' }
      }]
    })
    const virtualId = -saved.posts[0]!.postId
    const library = new CanonicalContentLibraryRepository(db.client)

    library.update({
      id: virtualId,
      name: 'Bài gốc đã sửa',
      enabled: true,
      variants: ['Nội dung mới'],
      image: { folderPath: '', mode: 'random', imagesPerPost: 1, missingPolicy: 'text_only' }
    })

    expect(pagePosts.get(page.id).posts[0]).toMatchObject({
      name: 'Bài gốc đã sửa',
      variants: ['Nội dung mới']
    })
    expect(() => library.delete(virtualId)).toThrow(/đang được sử dụng/i)
  })

  it('keeps a legacy global source in sync when its canonical post is edited from Tất cả bài viết', () => {
    const db = runtime('page-auto-canonical-library-legacy-')
    const legacy = new ContentLibraryRepository(db.client)
    const source = legacy.createSet({ name: 'Nguồn cũ' })
    legacy.createItem({
      contentSetId: source.id,
      name: 'Bài nguồn cũ',
      enabled: true,
      variants: ['Text cũ'],
      image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
    })

    const canonicalLibrary = new CanonicalContentLibraryRepository(db.client)
    const canonical = canonicalLibrary.get().items[0]!
    canonicalLibrary.update({
      id: canonical.id,
      name: 'Bài nguồn đã sửa',
      enabled: true,
      variants: ['Text mới'],
      image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
    })

    expect(legacy.get(source.id)?.items[0]).toMatchObject({
      name: 'Bài nguồn đã sửa',
      variants: ['Text mới']
    })
    expect(canonicalLibrary.get().items[0]).toMatchObject({
      name: 'Bài nguồn đã sửa',
      variants: ['Text mới']
    })
  })
})
