import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../database'
import { PageTabPostRepository } from '../database/pageTabPostRepository'
import { PageTabRepository } from '../database/pageTabRepository'
import { ConfigBackupService } from './configBackupService'

const directories: string[] = []

function runtime(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  directories.push(directory)
  return initializeDatabase(join(directory, 'page-auto.sqlite'))
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('ConfigBackupService Post Library', () => {
  it('round-trips multi-variant posts and per-post image settings', () => {
    const source = runtime('page-auto-post-backup-source-')
    const sourceTabs = new PageTabRepository(source.client)
    const sourcePosts = new PageTabPostRepository(source.client)
    const tab = sourceTabs.create({ name: 'Page A', pageUid: '90001' })
    sourcePosts.save({
      pageTabId: tab.id,
      mode: 'random',
      posts: [{
        name: 'Bài A', enabled: true, sortOrder: 0, variants: ['A1', 'A2'],
        image: { folderPath: 'D:\\a', mode: 'random', imagesPerPost: 2, missingPolicy: 'text_only' }
      }, {
        name: 'Bài B', enabled: false, sortOrder: 1, variants: ['B1'],
        image: { folderPath: 'D:\\b', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'skip' }
      }]
    })

    const raw = JSON.stringify(new ConfigBackupService(source.client).createPayload('1.0.0'))
    const target = runtime('page-auto-post-backup-target-')
    new ConfigBackupService(target.client).restoreFromJson(raw)
    const restoredTab = new PageTabRepository(target.client).list()[0]
    if (!restoredTab) throw new Error('Expected restored tab.')
    const restored = new PageTabPostRepository(target.client).get(restoredTab.id)

    expect(restored.mode).toBe('random')
    expect(restored.posts.map((post) => ({ name: post.name, enabled: post.enabled, variants: post.variants, image: post.image }))).toEqual([
      { name: 'Bài A', enabled: true, variants: ['A1', 'A2'], image: { folderPath: 'D:\\a', mode: 'random', imagesPerPost: 2, missingPolicy: 'text_only' } },
      { name: 'Bài B', enabled: false, variants: ['B1'], image: { folderPath: 'D:\\b', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'skip' } }
    ])

    target.close()
    source.close()
  })
})
