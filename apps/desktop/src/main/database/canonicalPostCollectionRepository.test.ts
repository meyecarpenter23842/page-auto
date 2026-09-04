import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../database'
import { CanonicalContentLibraryRepository } from './canonicalContentLibraryRepository'
import { CanonicalPostCollectionRepository } from './canonicalPostCollectionRepository'
import {
  CanonicalPostRepository,
  PageTabPostBindingRepository,
  ScenarioActionPostBindingRepository
} from './canonicalPostRepository'
import { ContentLibraryRepository } from './contentLibraryRepository'
import { PageTabRepository } from './pageTabRepository'

const directories: string[] = []
const runtimes: ReturnType<typeof initializeDatabase>[] = []

const image = { folderPath: '', mode: 'random' as const, imagesPerPost: 1, missingPolicy: 'text_only' as const }

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

describe('canonical post categories', () => {
  it('creates, renames, filters and moves canonical posts without cloning their identity', () => {
    const db = runtime('page-auto-post-categories-')
    const posts = new CanonicalPostRepository(db.client)
    const first = posts.create({ name: 'Bài A', variants: ['A'], image })
    const second = posts.create({ name: 'Bài B', variants: ['B'], image })
    const categories = new CanonicalPostCollectionRepository(db.client)

    const news = categories.create({ name: 'Tin mới' })
    const sales = categories.create({ name: 'Bán hàng' })
    categories.moveItems([-first.id], news.id)

    expect(categories.get(news.id)?.items.map((item) => item.id)).toEqual([-first.id])
    expect(categories.get(sales.id)?.items).toHaveLength(0)

    categories.moveItems([-first.id, -second.id], sales.id)
    expect(categories.get(news.id)?.items).toHaveLength(0)
    expect(categories.get(sales.id)?.items.map((item) => item.id)).toEqual([-first.id, -second.id])
    expect(posts.list().map((post) => post.id).sort((a, b) => a - b)).toEqual([first.id, second.id])

    const renamed = categories.rename({ id: sales.id, name: 'Khuyến mãi' })
    expect(renamed.name).toBe('Khuyến mãi')
    expect(categories.list().map((item) => item.name)).toContain('Khuyến mãi')

    expect(categories.delete(sales.id)).toBe(true)
    expect(categories.get(sales.id)).toBeNull()
    expect(posts.list()).toHaveLength(2)
    expect(new CanonicalContentLibraryRepository(db.client).get().items).toHaveLength(2)
  })

  it('keeps Page and Scenario canonical bindings unchanged when category metadata changes', () => {
    const db = runtime('page-auto-post-category-bindings-')
    const posts = new CanonicalPostRepository(db.client)
    const post = posts.create({ name: 'Bài dùng chung', variants: ['Nội dung'], image })
    const page = new PageTabRepository(db.client).create({ name: 'Page A', pageUid: 'page-a' })
    const pageBindings = new PageTabPostBindingRepository(db.client)
    pageBindings.bindExisting(page.id, post.id)

    const now = Date.now()
    const scenario = db.client.prepare(`
      INSERT INTO scenarios (name, random_action_order, runtime_limit_minutes, created_at, updated_at)
      VALUES ('Scenario A', 0, NULL, ?, ?)
    `).run(now, now)
    const action = db.client.prepare(`
      INSERT INTO scenario_actions (
        scenario_id, action_type, label, category, order_index, config_json, enabled, created_at, updated_at
      ) VALUES (?, 'post', 'Đăng bài', 'content', 0, '{}', 1, ?, ?)
    `).run(Number(scenario.lastInsertRowid), now, now)
    const scenarioBindings = new ScenarioActionPostBindingRepository(db.client)
    scenarioBindings.bindExisting(Number(action.lastInsertRowid), post.id)

    const categories = new CanonicalPostCollectionRepository(db.client)
    const first = categories.create({ name: 'Danh mục A' })
    const second = categories.create({ name: 'Danh mục B' })
    categories.moveItems([-post.id], first.id)
    categories.moveItems([-post.id], second.id)
    categories.rename({ id: second.id, name: 'Danh mục B mới' })
    categories.delete(second.id)

    expect(pageBindings.list(page.id).map((item) => item.postId)).toEqual([post.id])
    expect(scenarioBindings.list(Number(action.lastInsertRowid)).map((item) => item.postId)).toEqual([post.id])
    expect(posts.get(post.id)?.name).toBe('Bài dùng chung')
  })

  it('persists categories across a database restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-auto-post-category-restart-'))
    directories.push(directory)
    const databasePath = join(directory, 'page-auto.sqlite')

    const firstRuntime = initializeDatabase(databasePath)
    const post = new CanonicalPostRepository(firstRuntime.client).create({ name: 'Bài restart', variants: ['Text'], image })
    const created = new CanonicalPostCollectionRepository(firstRuntime.client).create({ name: 'Danh mục giữ lại' })
    new CanonicalPostCollectionRepository(firstRuntime.client).moveItems([-post.id], created.id)
    firstRuntime.close()

    const secondRuntime = initializeDatabase(databasePath)
    const restored = new CanonicalPostCollectionRepository(secondRuntime.client).get(created.id)
    expect(restored?.name).toBe('Danh mục giữ lại')
    expect(restored?.items.map((item) => item.id)).toEqual([-post.id])
    secondRuntime.close()
  })

  it('imports an unmapped legacy source once, then lets canonical category changes win without post loss', () => {
    const db = runtime('page-auto-post-category-legacy-')
    const legacy = new ContentLibraryRepository(db.client)
    const source = legacy.createSet({ name: 'Nguồn cũ' })
    legacy.createItem({
      contentSetId: source.id,
      name: 'Bài legacy',
      enabled: true,
      variants: ['Nội dung legacy'],
      image
    })

    const categories = new CanonicalPostCollectionRepository(db.client)
    const imported = categories.list().find((item) => item.name === 'Nguồn cũ')
    expect(imported).toBeTruthy()
    const itemId = categories.get(imported!.id)?.items[0]?.id
    expect(itemId).toBeLessThan(0)

    categories.rename({ id: imported!.id, name: 'Danh mục đã đổi' })
    categories.moveItems([itemId!], null)

    expect(categories.get(imported!.id)?.items).toHaveLength(0)
    expect(new CanonicalContentLibraryRepository(db.client).get().items.map((item) => item.id)).toContain(itemId)
    expect(categories.get(imported!.id)?.items).toHaveLength(0)

    categories.delete(imported!.id)
    expect(legacy.get(source.id)).toBeNull()
    expect(new CanonicalContentLibraryRepository(db.client).get().items.map((item) => item.id)).toContain(itemId)
  })
})
