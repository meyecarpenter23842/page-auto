import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CanonicalPostRepository,
  PageTabPostBindingRepository,
  ScenarioActionPostBindingRepository
} from '../database/canonicalPostRepository'
import { ContentLibraryRepository } from '../database/contentLibraryRepository'
import { initializeDatabase } from '../database'
import { PageTabPostRepository } from '../database/pageTabPostRepository'
import { PageTabRepository } from '../database/pageTabRepository'
import { ScenarioRepository } from '../database/scenarioRepository'
import { CONFIG_BACKUP_FORMAT, CONFIG_BACKUP_VERSION } from '../../shared/configBackup'
import { ConfigBackupService } from './configBackupService'

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

describe('Issue #188 canonical config backup v2', () => {
  it('exports canonical posts once and restores shared Page/Scenario identity with overrides', () => {
    const source = runtime('page-auto-canonical-backup-source-')
    const pages = new PageTabRepository(source.client)
    const pageA = pages.create({ name: 'Page A', pageUid: 'page-a' })
    const pageB = pages.create({ name: 'Page B', pageUid: 'page-b' })
    const canonical = new CanonicalPostRepository(source.client)
    const post = canonical.create({
      name: 'Bài gốc',
      variants: ['Nội dung gốc'],
      image: { folderPath: 'D:\\shared', mode: 'random', imagesPerPost: 2, missingPolicy: 'text_only' }
    })
    const pageBindings = new PageTabPostBindingRepository(source.client)
    pageBindings.bindExisting(pageA.id, post.id)
    pageBindings.bindExisting(pageB.id, post.id)
    pageBindings.updateOverrides(pageA.id, post.id, { name: 'Tên riêng Page A', variants: ['Nội dung riêng A'] })
    new PageTabPostRepository(source.client).save({
      pageTabId: pageA.id,
      mode: 'random',
      posts: [{
        name: 'compat A', enabled: true, sortOrder: 0, variants: ['compat A'],
        image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
      }]
    })

    const scenarios = new ScenarioRepository(source.client)
    const scenario = scenarios.create({ name: 'Kịch bản dùng chung' })
    const withAction = scenarios.createAction({
      scenarioId: scenario.id,
      actionType: 'post',
      label: 'Đăng bài',
      category: 'publishing',
      configJson: JSON.stringify({
        contentSetId: 999,
        selectionMode: 'sequential',
        postToWall: true,
        wallPageUid: 'page-a',
        wallPostsPerAccount: 1,
        postToGroups: false,
        groupTargets: '',
        groupPostsPerAccount: 1,
        postDelayMinSeconds: 0,
        postDelayMaxSeconds: 0
      })
    })
    const action = withAction.actions[0]!
    const scenarioBindings = new ScenarioActionPostBindingRepository(source.client)
    scenarioBindings.bindExisting(action.id, post.id)
    scenarioBindings.updateOverrides(action.id, post.id, { imageFolderPath: 'D:\\scenario-only' })

    const payload = new ConfigBackupService(source.client).createPayload('2.0.0')
    expect(payload.version).toBe(CONFIG_BACKUP_VERSION)
    expect(payload.posts).toHaveLength(1)
    const sharedKey = payload.posts[0]!.key
    expect(payload.pageTabs.map((tab) => tab.postBindings[0]?.postKey)).toEqual([sharedKey, sharedKey])
    expect(payload.scenarios[0]?.actions[0]?.postBindings[0]?.postKey).toBe(sharedKey)

    const target = runtime('page-auto-canonical-backup-target-')
    const result = new ConfigBackupService(target.client).restoreFromJson(JSON.stringify(payload))
    expect(result).toMatchObject({ canonicalPostsRestored: 1, scenariosRestored: 1, pageTabsCreated: 2 })
    expect(new CanonicalPostRepository(target.client).list()).toHaveLength(1)

    const restoredPages = new PageTabRepository(target.client).list()
    const restoredA = restoredPages.find((item) => item.name === 'Page A')!
    const restoredB = restoredPages.find((item) => item.name === 'Page B')!
    const restoredPageBindings = new PageTabPostBindingRepository(target.client)
    const bindingA = restoredPageBindings.list(restoredA.id)[0]!
    const bindingB = restoredPageBindings.list(restoredB.id)[0]!
    expect(bindingA.postId).toBe(bindingB.postId)
    expect(bindingA).toMatchObject({ name: 'Tên riêng Page A', variants: ['Nội dung riêng A'] })
    expect(bindingB).toMatchObject({ name: 'Bài gốc', variants: ['Nội dung gốc'] })
    expect(new PageTabPostRepository(target.client).get(restoredA.id).mode).toBe('random')

    const restoredScenario = new ScenarioRepository(target.client).list()[0]!
    const restoredAction = new ScenarioRepository(target.client).get(restoredScenario.id)!.actions[0]!
    const scenarioBinding = new ScenarioActionPostBindingRepository(target.client).list(restoredAction.id)[0]!
    expect(scenarioBinding.postId).toBe(bindingA.postId)
    expect(scenarioBinding.image.folderPath).toBe('D:\\scenario-only')
    expect(JSON.parse(restoredAction.configJson).contentSetId).toBeGreaterThan(0)
  })

  it('exports current global library as a collection and restores legacy UI compatibility', () => {
    const source = runtime('page-auto-content-backup-source-')
    const sourceLibrary = new ContentLibraryRepository(source.client)
    const set = sourceLibrary.createSet({ name: 'Nguồn dùng chung' })
    sourceLibrary.createItem({
      contentSetId: set.id,
      name: 'Bài backup',
      enabled: true,
      variants: ['Nội dung 1', 'Nội dung 2'],
      image: { folderPath: 'D:\\post-images', mode: 'random', imagesPerPost: 2, missingPolicy: 'text_only' }
    })

    const payload = new ConfigBackupService(source.client).createPayload('2.0.0')
    expect(payload.postCollections).toEqual([{
      key: expect.any(String),
      name: 'Nguồn dùng chung',
      bindings: [expect.objectContaining({ postKey: expect.any(String), enabled: true, sortOrder: 0 })]
    }])
    expect(payload.posts).toEqual([expect.objectContaining({
      name: 'Bài backup',
      variants: ['Nội dung 1', 'Nội dung 2'],
      image: { folderPath: 'D:\\post-images', mode: 'random', imagesPerPost: 2, missingPolicy: 'text_only' }
    })])

    const target = runtime('page-auto-content-backup-target-')
    const restore = new ConfigBackupService(target.client).restoreFromJson(JSON.stringify(payload))
    const restored = new ContentLibraryRepository(target.client).list()
    expect(restore.contentLibrariesRestored).toBe(1)
    expect(restored).toHaveLength(1)
    expect(new ContentLibraryRepository(target.client).get(restored[0]!.id)?.items[0]).toMatchObject({
      name: 'Bài backup',
      variants: ['Nội dung 1', 'Nội dung 2']
    })
    const collections = target.client.prepare('SELECT COUNT(*) AS count FROM post_collections').get() as { count: number }
    expect(collections.count).toBe(1)
  })

  it('upgrades old v1 files into canonical posts instead of requiring the old physical model', () => {
    const target = runtime('page-auto-content-backup-v1-')
    const legacy = {
      format: CONFIG_BACKUP_FORMAT,
      version: 1,
      appVersion: '1.0.0',
      exportedAt: Date.now(),
      security: { containsSecrets: false, excludes: [] },
      accounts: [],
      pageTabs: [{
        name: 'Page legacy',
        pageUid: 'legacy-page',
        rotation: {
          postsPerAccount: 1,
          postDelayMinSeconds: 0,
          postDelayMaxSeconds: 0,
          accountDelayMinSeconds: 0,
          accountDelayMaxSeconds: 0,
          accountOrderMode: 'sequential'
        },
        accounts: [],
        schedules: [],
        groupUids: ['g-1'],
        contentMode: 'sequential',
        contents: ['legacy'],
        image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' },
        postLibrary: {
          mode: 'random',
          posts: [{
            name: 'Bài Page v1',
            enabled: true,
            sortOrder: 0,
            variants: ['Cùng text'],
            image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
          }]
        }
      }],
      contentLibraries: [{
        name: 'Nguồn v1',
        items: [{
          name: 'Bài nguồn v1',
          enabled: true,
          variants: ['Cùng text'],
          image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
        }]
      }],
      importPresets: [],
      accountColumnLayout: null
    }

    const result = new ConfigBackupService(target.client).restoreFromJson(JSON.stringify(legacy))
    expect(result).toMatchObject({ canonicalPostsRestored: 2, pageTabsCreated: 1, contentLibrariesRestored: 1 })
    const canonical = new CanonicalPostRepository(target.client).list()
    expect(canonical).toHaveLength(2)
    expect(canonical.map((post) => post.variants[0])).toEqual(['Cùng text', 'Cùng text'])
    const page = new PageTabRepository(target.client).list()[0]!
    const pageBinding = new PageTabPostBindingRepository(target.client).list(page.id)[0]!
    expect(new PageTabPostRepository(target.client).get(page.id).mode).toBe('random')
    const collectionPostId = target.client.prepare('SELECT post_id AS postId FROM post_collection_bindings LIMIT 1').get() as { postId: number }
    expect(pageBinding.postId).not.toBe(collectionPostId.postId)
  })
})
