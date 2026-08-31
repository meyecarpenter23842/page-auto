import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from './index'
import { ContentLibraryRepository } from './contentLibraryRepository'
import { PageTabRepository } from './pageTabRepository'

const tempDirectories: string[] = []
const runtimes: ReturnType<typeof initializeDatabase>[] = []

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close()
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-content-library-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  runtimes.push(runtime)
  return {
    runtime,
    library: new ContentLibraryRepository(runtime.client),
    tabs: new PageTabRepository(runtime.client)
  }
}

describe('K4.5.1 global content library', () => {
  it('applies schema v17 and keeps global sets separate from legacy Page Tab content', () => {
    const { runtime, library, tabs } = setup()
    const tab = tabs.create({ name: 'Page A', pageUid: '90001' })
    const global = library.createSet({ name: 'Nguồn chung' }, 1000)

    const schemaVersion = runtime.client.prepare("SELECT value FROM app_settings WHERE key = 'schema_version'").get() as { value: string }
    const rows = runtime.client.prepare('SELECT id, page_tab_id AS pageTabId FROM content_sets ORDER BY id').all() as Array<{ id: number; pageTabId: number | null }>
    const pageTabColumn = runtime.client.prepare('PRAGMA table_info(content_sets)').all() as Array<{ name: string; notnull: number }>

    expect(schemaVersion.value).toBe('17')
    expect(rows).toEqual([
      expect.objectContaining({ pageTabId: tab.id }),
      expect.objectContaining({ id: global.id, pageTabId: null })
    ])
    expect(pageTabColumn.find((column) => column.name === 'page_tab_id')?.notnull).toBe(0)
    expect(library.list()).toHaveLength(1)
  })

  it('creates, edits, reorders and deletes reusable global posts with media config', () => {
    const { library } = setup()
    const set = library.createSet({ name: 'Sale tháng 9' }, 1000)
    let details = library.createItem({
      contentSetId: set.id,
      name: 'Bài A',
      enabled: true,
      variants: ['Nội dung A1', 'Nội dung A2'],
      image: { folderPath: 'D:\\images-a', mode: 'random', imagesPerPost: 2, missingPolicy: 'text_only' }
    }, 1100)
    details = library.createItem({
      contentSetId: set.id,
      name: 'Bài B',
      enabled: false,
      variants: ['Nội dung B'],
      image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'skip' }
    }, 1200)

    expect(details.items.map((item) => item.name)).toEqual(['Bài A', 'Bài B'])
    expect(details.items[0]).toMatchObject({
      variants: ['Nội dung A1', 'Nội dung A2'],
      image: { folderPath: 'D:\\images-a', mode: 'random', imagesPerPost: 2 }
    })

    const second = details.items[1]!
    details = library.moveItem({ contentSetId: set.id, itemId: second.id, direction: 'up' }, 1300)
    expect(details.items.map((item) => item.name)).toEqual(['Bài B', 'Bài A'])

    const first = details.items[0]!
    details = library.updateItem({
      id: first.id,
      name: 'Bài B sửa',
      enabled: true,
      variants: ['B mới'],
      image: { folderPath: 'E:\\media', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
    }, 1400)
    expect(details.enabledCount).toBe(2)
    expect(details.items[0]?.name).toBe('Bài B sửa')

    details = library.deleteItem(first.id, 1500)
    expect(details.items).toHaveLength(1)
    expect(details.items[0]?.sortOrder).toBe(0)
    expect(library.renameSet({ id: set.id, name: 'Sale mới' }, 1600).name).toBe('Sale mới')
    expect(library.deleteSet(set.id)).toBe(true)
    expect(library.list()).toEqual([])
  })

  it('does not allow the global repository to mutate legacy Page Tab content sets', () => {
    const { runtime, library, tabs } = setup()
    const tab = tabs.create({ name: 'Legacy', pageUid: '90002' })
    const legacySet = runtime.client.prepare('SELECT id FROM content_sets WHERE page_tab_id = ?').get(tab.id) as { id: number }

    expect(library.get(legacySet.id)).toBeNull()
    expect(() => library.renameSet({ id: legacySet.id, name: 'Không được' })).toThrow('Thư viện chung')
    expect(library.deleteSet(legacySet.id)).toBe(false)
  })

  it('keeps legacy PageTabRepository content writes working after the v13 rebuild', () => {
    const { runtime, tabs } = setup()
    const tab = tabs.create({ name: 'Page legacy', pageUid: '90003' })
    const updated = tabs.update(tab.id, {
      name: tab.name,
      pageUid: tab.pageUid,
      rotation: { ...tab.rotation },
      accounts: [],
      schedules: [],
      groupUids: [],
      contentMode: 'sequential',
      contents: ['legacy A', 'legacy B'],
      image: { ...tab.image }
    })

    expect(updated.contents).toEqual(['legacy A', 'legacy B'])
    const columns = runtime.client.prepare('PRAGMA table_info(content_items)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'variants_json', 'image_folder_path', 'images_per_post', 'missing_policy'
    ]))
    const legacyRows = runtime.client.prepare(`
      SELECT ci.content, ci.variants_json AS variantsJson
      FROM content_items ci
      JOIN content_sets cs ON cs.id = ci.content_set_id
      WHERE cs.page_tab_id = ?
      ORDER BY ci.sort_order
    `).all(tab.id) as Array<{ content: string; variantsJson: string }>
    expect(legacyRows).toEqual([
      { content: 'legacy A', variantsJson: '[]' },
      { content: 'legacy B', variantsJson: '[]' }
    ])
  })
})