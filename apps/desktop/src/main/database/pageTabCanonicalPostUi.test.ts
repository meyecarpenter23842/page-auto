import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SavePageTabPostItemInput } from '../../shared/pageTabs'
import { initializeDatabase } from './index'
import { CanonicalPostRepository, PageTabPostBindingRepository, ScenarioActionPostBindingRepository } from './canonicalPostRepository'
import { ContentLibraryRepository } from './contentLibraryRepository'
import { LegacyCanonicalPostBridge } from './legacyCanonicalPostBridge'
import { PageTabPostRepository } from './pageTabPostRepository'
import { PageTabRepository } from './pageTabRepository'
import { ScenarioRepository } from './scenarioRepository'

const tempDirectories: string[] = []
const runtimes: ReturnType<typeof initializeDatabase>[] = []

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close()
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-canonical-ui-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  runtimes.push(runtime)
  return {
    runtime,
    pageTabs: new PageTabRepository(runtime.client),
    pagePosts: new PageTabPostRepository(runtime.client),
    canonical: new CanonicalPostRepository(runtime.client),
    bindings: new PageTabPostBindingRepository(runtime.client),
    scenarios: new ScenarioRepository(runtime.client),
    scenarioBindings: new ScenarioActionPostBindingRepository(runtime.client),
    legacyLibrary: new ContentLibraryRepository(runtime.client),
    bridge: new LegacyCanonicalPostBridge(runtime.client)
  }
}

const image = {
  folderPath: '',
  mode: 'random' as const,
  imagesPerPost: 1,
  missingPolicy: 'text_only' as const
}

function savePost(name: string, content: string, postId?: number | null): SavePageTabPostItemInput {
  const base: SavePageTabPostItemInput = {
    name,
    enabled: true,
    sortOrder: 0,
    variants: [content],
    image: { ...image }
  }
  return postId === undefined ? base : { ...base, postId }
}

describe('Issue #188 Page canonical UI cutover', () => {
  it('creates once, binds the same post to another Page, and unlinks without deleting canonical content', () => {
    const { pageTabs, pagePosts, canonical } = setup()
    const pageA = pageTabs.create({ name: 'Page A', pageUid: 'page-a' })
    const pageB = pageTabs.create({ name: 'Page B', pageUid: 'page-b' })

    const savedA = pagePosts.save({ pageTabId: pageA.id, mode: 'sequential', posts: [savePost('Bài chung', 'Nội dung gốc', null)] })
    const postId = savedA.posts[0]?.postId
    expect(postId).toBeTypeOf('number')
    expect(canonical.list()).toHaveLength(1)

    const savedB = pagePosts.save({ pageTabId: pageB.id, mode: 'random', posts: [savePost('Bài chung', 'Nội dung gốc', postId)] })
    expect(savedB.posts[0]?.postId).toBe(postId)
    expect(canonical.list()).toHaveLength(1)

    const removedA = pagePosts.save({ pageTabId: pageA.id, mode: 'sequential', posts: [] })
    expect(removedA.posts).toEqual([])
    expect(canonical.get(postId!)).not.toBeNull()
    expect(pagePosts.get(pageB.id).posts[0]?.postId).toBe(postId)
  })

  it('stores Page-specific edits as overrides and clears them when values return to canonical', () => {
    const { pageTabs, pagePosts, canonical } = setup()
    const pageA = pageTabs.create({ name: 'Page A', pageUid: 'page-a' })
    const pageB = pageTabs.create({ name: 'Page B', pageUid: 'page-b' })

    const created = pagePosts.save({ pageTabId: pageA.id, mode: 'sequential', posts: [savePost('Gốc', 'base', null)] })
    const postId = created.posts[0]!.postId
    pagePosts.save({ pageTabId: pageB.id, mode: 'sequential', posts: [savePost('Gốc', 'base', postId)] })

    const pageAEdited = pagePosts.save({
      pageTabId: pageA.id,
      mode: 'sequential',
      posts: [savePost('Tên riêng A', 'page-a-only', postId)]
    })

    expect(pageAEdited.posts[0]?.overrides).toMatchObject({ name: 'Tên riêng A', variants: ['page-a-only'] })
    expect(canonical.require(postId)).toMatchObject({ name: 'Gốc', variants: ['base'] })
    expect(pagePosts.get(pageB.id).posts[0]).toMatchObject({ name: 'Gốc', variants: ['base'] })

    const canonicalPost = canonical.require(postId)
    const reset = pagePosts.save({
      pageTabId: pageA.id,
      mode: 'sequential',
      posts: [{
        postId,
        name: canonicalPost.name,
        enabled: true,
        sortOrder: 0,
        variants: [...canonicalPost.variants],
        image: { ...canonicalPost.image }
      }]
    })
    expect(reset.posts[0]?.overrides).toEqual({
      name: null,
      variants: null,
      imageFolderPath: null,
      imageMode: null,
      imagesPerPost: null,
      missingPolicy: null
    })
  })

  it('reconciles Page legacy rows created after v14 before canonical UI reads them', () => {
    const { runtime, pageTabs, pagePosts, canonical, bindings } = setup()
    const page = pageTabs.create({ name: 'Page Legacy', pageUid: 'legacy-page' })
    const now = Date.now() + 5_000

    runtime.client.prepare(`
      INSERT INTO page_tab_posts (
        page_tab_id, name, enabled, variants_json,
        image_folder_path, image_mode, images_per_post, missing_policy,
        sort_order, created_at, updated_at
      ) VALUES (?, ?, 1, ?, '', 'random', 1, 'text_only', 0, ?, ?)
    `).run(page.id, 'Legacy mới', JSON.stringify(['legacy-new']), now, now)

    const library = pagePosts.get(page.id)
    expect(library.legacyFallback).toBe(true)
    expect(library.posts).toHaveLength(1)
    expect(library.posts[0]).toMatchObject({ name: 'Legacy mới', variants: ['legacy-new'] })
    expect(canonical.list()).toHaveLength(1)
    expect(bindings.list(page.id)[0]?.postId).toBe(library.posts[0]?.postId)
  })

  it('bridges legacy global-library edits into canonical posts and existing Scenario post bindings', () => {
    const { legacyLibrary, bridge, canonical, scenarios, scenarioBindings } = setup()
    const set = legacyLibrary.createSet({ name: 'Kho cũ' }, 1_000)
    const withItem = legacyLibrary.createItem({
      contentSetId: set.id,
      name: 'Bài legacy',
      enabled: true,
      variants: ['v1'],
      image: { ...image }
    }, 1_010)
    const item = withItem.items[0]
    if (!item) throw new Error('Content library fixture missing item.')

    const scenario = scenarios.create({ name: 'KB A' }, 1_020)
    const details = scenarios.createAction({
      scenarioId: scenario.id,
      actionType: 'post',
      label: 'Đăng bài',
      category: 'publishing',
      configJson: JSON.stringify({ contentSetId: set.id })
    }, 1_030)
    const action = details.actions[0]
    if (!action) throw new Error('Scenario action fixture missing.')

    bridge.syncGlobalSet(set.id, 1_040)
    const canonicalPost = canonical.list()[0]
    expect(canonicalPost).toMatchObject({ name: 'Bài legacy', variants: ['v1'] })
    expect(scenarioBindings.list(action.id).map((binding) => binding.postId)).toEqual([canonicalPost!.id])

    legacyLibrary.updateItem({
      id: item.id,
      name: 'Bài legacy v2',
      enabled: true,
      variants: ['v2'],
      image: { ...image, imagesPerPost: 2 }
    }, 1_050)
    bridge.syncGlobalSet(set.id, 1_060)

    expect(canonical.require(canonicalPost!.id)).toMatchObject({
      name: 'Bài legacy v2',
      variants: ['v2'],
      image: { imagesPerPost: 2 }
    })
    expect(scenarioBindings.list(action.id)[0]).toMatchObject({
      postId: canonicalPost!.id,
      name: 'Bài legacy v2',
      variants: ['v2']
    })
  })

  it('keeps Page duplicate bindings on the same canonical post identities even through the old renderer save contract', () => {
    const { pageTabs, pagePosts, canonical, bindings } = setup()
    const source = pageTabs.create({ name: 'Page A', pageUid: 'page-a' })
    const sourceLibrary = pagePosts.save({
      pageTabId: source.id,
      mode: 'random',
      posts: [savePost('Gốc', 'base', null)]
    })
    const postId = sourceLibrary.posts[0]!.postId

    const overridden = pagePosts.save({
      pageTabId: source.id,
      mode: 'random',
      posts: [savePost('Tên riêng', 'override', postId)]
    })
    expect(overridden.posts[0]?.overrides.variants).toEqual(['override'])

    const copy = pageTabs.duplicate(source.id)
    // PageTabsManagerV2 currently sends only resolved values after duplicatePageTab().
    // The canonical repository compatibility path must infer the source identity instead of cloning content.
    const copiedLibrary = pagePosts.save({
      pageTabId: copy.id,
      mode: overridden.mode,
      posts: overridden.posts.map((post, index) => ({
        name: post.name,
        enabled: post.enabled,
        sortOrder: index,
        variants: [...post.variants],
        image: { ...post.image }
      }))
    })

    expect(canonical.list()).toHaveLength(1)
    expect(copiedLibrary.posts[0]?.postId).toBe(postId)
    expect(copiedLibrary.posts[0]?.overrides).toEqual(overridden.posts[0]?.overrides)
    expect(bindings.list(source.id)[0]?.postId).toBe(postId)
    expect(bindings.list(copy.id)[0]?.postId).toBe(postId)
  })
})
