import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../database'
import { ContentLibraryRepository } from '../database/contentLibraryRepository'
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

function addSource(library: ContentLibraryRepository, name: string, content: string) {
  const set = library.createSet({ name })
  library.createItem({
    contentSetId: set.id,
    name: `Bài ${name}`,
    enabled: true,
    variants: [content],
    image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
  })
}

describe('K4.5.1 content library backup name matching', () => {
  it('preserves distinct Vietnamese names that differ by diacritics', () => {
    const source = runtime('page-auto-content-name-source-')
    const sourceLibrary = new ContentLibraryRepository(source.client)
    addSource(sourceLibrary, 'Ban', 'plain-content')
    addSource(sourceLibrary, 'Bán', 'accent-content')

    const payload = new ConfigBackupService(source.client).createPayload('1.0.0')
    expect(payload.postCollections.map((item) => item.name).sort()).toEqual(['Ban', 'Bán'].sort())

    const target = runtime('page-auto-content-name-target-')
    new ConfigBackupService(target.client).restoreFromJson(JSON.stringify(payload))
    const targetLibrary = new ContentLibraryRepository(target.client)
    const restored = targetLibrary.list()

    expect(restored).toHaveLength(2)
    const contents = restored.map((item) => {
      const details = targetLibrary.get(item.id)
      return [item.name, details?.items[0]?.variants[0] ?? null]
    })
    expect(contents).toEqual(expect.arrayContaining([
      ['Ban', 'plain-content'],
      ['Bán', 'accent-content']
    ]))
  })
})
