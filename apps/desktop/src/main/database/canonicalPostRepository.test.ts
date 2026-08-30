import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from './index'
import { PageTabRepository } from './pageTabRepository'
import { ScenarioRepository } from './scenarioRepository'
import {
  CanonicalPostRepository,
  PageTabPostBindingRepository,
  ScenarioActionPostBindingRepository,
  type CanonicalPostDraft
} from './canonicalPostRepository'

const tempDirectories: string[] = []
const runtimes: ReturnType<typeof initializeDatabase>[] = []

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close()
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-canonical-post-repo-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  runtimes.push(runtime)
  return {
    runtime,
    canonical: new CanonicalPostRepository(runtime.client),
    pages: new PageTabPostBindingRepository(runtime.client),
    scenarioPosts: new ScenarioActionPostBindingRepository(runtime.client),
    pageTabs: new PageTabRepository(runtime.client),
    scenarios: new ScenarioRepository(runtime.client)
  }
}

function draft(name: string, content: string, folderPath = ''): CanonicalPostDraft {
  return {
    name,
    variants: content ? [content] : [],
    image: {
      folderPath,
      mode: 'random',
      imagesPerPost: 1,
      missingPolicy: 'text_only'
    }
  }
}

describe('Issue #188 canonical post repositories', () => {
  it('creates once, binds across Page contexts, and unlinks without deleting canonical content', () => {
    const { canonical, pages, pageTabs } = setup()
    const pageA = pageTabs.create({ name: 'Page A', pageUid: 'page-a' })
    const pageB = pageTabs.create({ name: 'Page B', pageUid: 'page-b' })

    const created = pages.createAndBind(pageA.id, draft('Bài chung', 'Nội dung gốc'), 1000)

    expect(canonical.list()).toHaveLength(1)
    expect(created.postId).toBe(canonical.list()[0]?.id)
    expect(pages.list(pageA.id).map((item) => item.postId)).toEqual([created.postId])
    expect(pages.list(pageB.id)).toEqual([])

    const boundToB = pages.bindExisting(pageB.id, created.postId, 1100)
    expect(boundToB.postId).toBe(created.postId)
    expect(canonical.list()).toHaveLength(1)

    expect(() => canonical.delete(created.postId)).toThrow('đang được sử dụng')
    expect(pages.unlink(pageA.id, created.postId, 1200)).toBe(true)
    expect(canonical.get(created.postId)?.name).toBe('Bài chung')
    expect(pages.list(pageB.id)).toHaveLength(1)
    expect(() => canonical.delete(created.postId)).toThrow('đang được sử dụng')

    expect(pages.unlink(pageB.id, created.postId, 1300)).toBe(true)
    expect(canonical.delete(created.postId)).toBe(true)
    expect(canonical.get(created.postId)).toBeNull()
  })

  it('keeps Page overrides isolated while non-overridden fields follow canonical edits', () => {
    const { canonical, pages, pageTabs } = setup()
    const pageA = pageTabs.create({ name: 'Page A', pageUid: 'page-a' })
    const pageB = pageTabs.create({ name: 'Page B', pageUid: 'page-b' })
    const post = canonical.create(draft('Bản gốc', 'base-v1', 'C:/base-v1'), 1000)
    pages.bindExisting(pageA.id, post.id, 1010)
    pages.bindExisting(pageB.id, post.id, 1020)

    pages.updateOverrides(pageA.id, post.id, {
      variants: ['page-a-only'],
      imageFolderPath: 'D:/page-a'
    }, 1100)

    canonical.update(post.id, {
      name: 'Bản gốc v2',
      variants: ['base-v2'],
      image: {
        folderPath: 'C:/base-v2',
        mode: 'sequential',
        imagesPerPost: 2,
        missingPolicy: 'skip'
      }
    }, 1200)

    const resolvedA = pages.list(pageA.id)[0]
    const resolvedB = pages.list(pageB.id)[0]
    expect(resolvedA).toMatchObject({
      postId: post.id,
      name: 'Bản gốc v2',
      variants: ['page-a-only'],
      image: { folderPath: 'D:/page-a', mode: 'sequential', imagesPerPost: 2, missingPolicy: 'skip' }
    })
    expect(resolvedB).toMatchObject({
      postId: post.id,
      name: 'Bản gốc v2',
      variants: ['base-v2'],
      image: { folderPath: 'C:/base-v2', mode: 'sequential', imagesPerPost: 2, missingPolicy: 'skip' }
    })

    const inheritedAgain = pages.updateOverrides(pageA.id, post.id, {
      variants: null,
      imageFolderPath: null
    }, 1300)
    expect(inheritedAgain.variants).toEqual(['base-v2'])
    expect(inheritedAgain.image.folderPath).toBe('C:/base-v2')
  })

  it('resolves Scenario Action bindings from the same canonical post without mutating Page bindings', () => {
    const { canonical, pages, scenarioPosts, pageTabs, scenarios } = setup()
    const page = pageTabs.create({ name: 'Page A', pageUid: 'page-a' })
    const scenario = scenarios.create({ name: 'KB A' }, 1000)
    const withAction = scenarios.createAction({
      scenarioId: scenario.id,
      actionType: 'post',
      label: 'Đăng bài',
      category: 'publishing',
      configJson: '{}'
    }, 1010)
    const action = withAction.actions[0]
    if (!action) throw new Error('Scenario action fixture was not created.')

    const post = canonical.create(draft('Shared', 'shared-v1'), 1020)
    pages.bindExisting(page.id, post.id, 1030)
    scenarioPosts.bindExisting(action.id, post.id, 1040)
    scenarioPosts.updateOverrides(action.id, post.id, { name: 'Tên riêng KB' }, 1050)

    expect(pages.list(page.id)[0]?.name).toBe('Shared')
    expect(scenarioPosts.list(action.id)[0]?.name).toBe('Tên riêng KB')
    expect(canonical.list()).toHaveLength(1)

    const frozen = scenarioPosts.resolveSnapshotPosts(action.id)
    expect(frozen[0]).toMatchObject({ name: 'Tên riêng KB', variants: ['shared-v1'] })

    canonical.update(post.id, draft('Shared v2', 'shared-v2'), 1100)

    expect(frozen[0]).toMatchObject({ name: 'Tên riêng KB', variants: ['shared-v1'] })
    expect(scenarioPosts.resolveSnapshotPosts(action.id)[0]).toMatchObject({
      name: 'Tên riêng KB',
      variants: ['shared-v2']
    })
    expect(pages.resolveSnapshotPosts(page.id)[0]).toMatchObject({
      name: 'Shared v2',
      variants: ['shared-v2']
    })
  })

  it('keeps binding enabled/order state in the context and snapshots only enabled posts', () => {
    const { pages, pageTabs } = setup()
    const page = pageTabs.create({ name: 'Page A', pageUid: 'page-a' })
    const first = pages.createAndBind(page.id, draft('A', 'A'), 1000)
    const second = pages.createAndBind(page.id, draft('B', 'B'), 1010)
    const third = pages.createAndBind(page.id, draft('C', 'C'), 1020)

    expect(pages.list(page.id).map((item) => item.name)).toEqual(['A', 'B', 'C'])
    pages.move(page.id, third.postId, 'up', 1030)
    expect(pages.list(page.id).map((item) => item.name)).toEqual(['A', 'C', 'B'])

    pages.setEnabled(page.id, first.postId, false, 1040)
    expect(pages.resolveSnapshotPosts(page.id).map((item) => item.name)).toEqual(['C', 'B'])

    expect(pages.unlink(page.id, third.postId, 1050)).toBe(true)
    expect(pages.list(page.id).map((item) => ({ name: item.name, sortOrder: item.sortOrder }))).toEqual([
      { name: 'A', sortOrder: 0 },
      { name: 'B', sortOrder: 1 }
    ])
    expect(second.postId).toBeGreaterThan(0)
  })

  it('rolls back canonical creation if create-and-bind cannot complete', () => {
    const { runtime, canonical, pages, pageTabs } = setup()
    const page = pageTabs.create({ name: 'Page A', pageUid: 'page-a' })
    runtime.client.exec(`
      CREATE TRIGGER reject_issue_188_binding
      BEFORE INSERT ON page_tab_post_bindings
      WHEN NEW.page_tab_id = ${page.id}
      BEGIN
        SELECT RAISE(ABORT, 'fixture binding rejection');
      END;
    `)

    expect(() => pages.createAndBind(page.id, draft('Rollback me', 'content'), 1000))
      .toThrow('fixture binding rejection')
    expect(canonical.list()).toEqual([])
  })
})
