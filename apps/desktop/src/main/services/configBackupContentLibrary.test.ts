import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ContentLibraryRepository } from '../database/contentLibraryRepository'
import { initializeDatabase } from '../database'
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

describe('K4.5.1 content library config backup', () => {
  it('exports and restores global content sources without converting legacy Page Tab content', () => {
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

    const payload = new ConfigBackupService(source.client).createPayload('1.0.0')
    expect(payload.contentLibraries).toEqual([{
      name: 'Nguồn dùng chung',
      items: [expect.objectContaining({
        name: 'Bài backup',
        variants: ['Nội dung 1', 'Nội dung 2'],
        image: { folderPath: 'D:\\post-images', mode: 'random', imagesPerPost: 2, missingPolicy: 'text_only' }
      })]
    }])

    const target = runtime('page-auto-content-backup-target-')
    const restore = new ConfigBackupService(target.client).restoreFromJson(JSON.stringify(payload))
    const restored = new ContentLibraryRepository(target.client).list()
    expect(restore.contentLibrariesRestored).toBe(1)
    expect(restored).toHaveLength(1)
    expect(new ContentLibraryRepository(target.client).get(restored[0]!.id)?.items[0]).toMatchObject({
      name: 'Bài backup',
      variants: ['Nội dung 1', 'Nội dung 2']
    })
  })

  it('keeps old config backup v1 files without contentLibraries compatible', () => {
    const target = runtime('page-auto-content-backup-legacy-')
    const service = new ConfigBackupService(target.client)
    const payload = service.createPayload('1.0.0')
    delete payload.contentLibraries

    const result = service.restoreFromJson(JSON.stringify(payload))
    expect(result.contentLibrariesRestored).toBe(0)
    expect(new ContentLibraryRepository(target.client).list()).toEqual([])
  })
})
