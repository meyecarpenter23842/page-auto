import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from './index'
import { PageTabPostRepository } from './pageTabPostRepository'
import { PageTabRepository } from './pageTabRepository'
import { RunRepository } from './runRepository'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function createRuntime() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-post-library-'))
  tempDirectories.push(directory)
  return initializeDatabase(join(directory, 'page-auto.sqlite'))
}

function configureLegacyTab() {
  const runtime = createRuntime()
  const tabs = new PageTabRepository(runtime.client)
  const posts = new PageTabPostRepository(runtime.client)
  const tab = tabs.create({ name: 'Page A', pageUid: '90001' })
  tabs.update(tab.id, {
    name: tab.name,
    pageUid: tab.pageUid,
    rotation: tab.rotation,
    accounts: [],
    schedules: [],
    groupUids: ['group-1'],
    contentMode: 'random',
    contents: ['Legacy A', 'Legacy B'],
    image: { folderPath: 'D:\\legacy-images', mode: 'sequential', imagesPerPost: 2, missingPolicy: 'skip' }
  })
  return { runtime, tabs, posts, tab }
}

describe('PageTabPostRepository', () => {
  it('projects legacy Content/Image config into the new library without data loss', () => {
    const { runtime, posts, tab } = configureLegacyTab()
    const library = posts.get(tab.id)

    expect(library.legacyFallback).toBe(true)
    expect(library.mode).toBe('random')
    expect(library.posts.map((post) => post.variants)).toEqual([['Legacy A'], ['Legacy B']])
    expect(library.posts[0]?.image).toEqual({
      folderPath: 'D:\\legacy-images',
      mode: 'sequential',
      imagesPerPost: 2,
      missingPolicy: 'skip'
    })

    runtime.close()
  })

  it('persists independent variants and image settings for each post and keeps legacy rows compatible', () => {
    const { runtime, tabs, posts, tab } = configureLegacyTab()
    const saved = posts.save({
      pageTabId: tab.id,
      mode: 'sequential',
      posts: [
        {
          name: 'Mỹ phẩm',
          enabled: true,
          sortOrder: 0,
          variants: ['Cách viết A', 'Cách viết B', '  '],
          image: { folderPath: 'D:\\post-a', mode: 'random', imagesPerPost: 3, missingPolicy: 'text_only' }
        },
        {
          name: 'Sale',
          enabled: false,
          sortOrder: 1,
          variants: ['Sale A'],
          image: { folderPath: 'D:\\post-b', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'skip' }
        }
      ]
    })

    expect(saved.legacyFallback).toBe(false)
    expect(saved.posts).toHaveLength(2)
    expect(saved.posts[0]).toMatchObject({ name: 'Mỹ phẩm', enabled: true, variants: ['Cách viết A', 'Cách viết B'] })
    expect(saved.posts[0]?.image).toEqual({ folderPath: 'D:\\post-a', mode: 'random', imagesPerPost: 3, missingPolicy: 'text_only' })
    expect(saved.posts[1]?.image.folderPath).toBe('D:\\post-b')

    const legacy = tabs.get(tab.id)
    expect(legacy?.contentMode).toBe('sequential')
    expect(legacy?.contents).toEqual(['Cách viết A', 'Sale A'])
    expect(legacy?.image.folderPath).toBe('D:\\post-a')

    runtime.close()
  })

  it('deep-copies a post library when a Page Tab is duplicated', () => {
    const { runtime, tabs, posts, tab } = configureLegacyTab()
    posts.save({
      pageTabId: tab.id,
      mode: 'random',
      posts: [{
        name: 'Original',
        enabled: true,
        sortOrder: 0,
        variants: ['A', 'B'],
        image: { folderPath: 'D:\\one', mode: 'random', imagesPerPost: 2, missingPolicy: 'text_only' }
      }]
    })
    const copy = tabs.duplicate(tab.id)
    const copied = posts.copy(tab.id, copy.id)

    expect(copied.pageTabId).toBe(copy.id)
    expect(copied.mode).toBe('random')
    expect(copied.posts[0]).toMatchObject({ name: 'Original', variants: ['A', 'B'] })
    expect(copied.posts[0]?.id).not.toBe(posts.get(tab.id).posts[0]?.id)

    runtime.close()
  })

  it('freezes the post library into a new run snapshot', () => {
    const { runtime, posts, tab } = configureLegacyTab()
    posts.save({
      pageTabId: tab.id,
      mode: 'random',
      posts: [{
        name: 'Snapshot post', enabled: true, sortOrder: 0, variants: ['One', 'Two'],
        image: { folderPath: 'D:\\snapshot', mode: 'random', imagesPerPost: 2, missingPolicy: 'text_only' }
      }]
    })
    const run = new RunRepository(runtime.client).createForPageTab(tab.id)
    expect(run.run.snapshot.postMode).toBe('random')
    expect(run.run.snapshot.posts).toEqual([{
      name: 'Snapshot post', enabled: true, sortOrder: 0, variants: ['One', 'Two'],
      image: { folderPath: 'D:\\snapshot', mode: 'random', imagesPerPost: 2, missingPolicy: 'text_only' }
    }])
    runtime.close()
  })

  it('rejects an enabled post with no usable variant', () => {
    const { runtime, posts, tab } = configureLegacyTab()
    expect(() => posts.save({
      pageTabId: tab.id,
      mode: 'sequential',
      posts: [{
        name: 'Empty',
        enabled: true,
        sortOrder: 0,
        variants: ['  '],
        image: { folderPath: '', mode: 'random', imagesPerPost: 1, missingPolicy: 'text_only' }
      }]
    })).toThrow('chưa có nội dung')
    runtime.close()
  })
})
