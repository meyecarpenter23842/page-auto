import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from './index'
import { StoryRepository } from './storyRepository'

const runtimes: ReturnType<typeof initializeDatabase>[] = []
const directories: string[] = []

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-story-'))
  directories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  runtimes.push(runtime)
  return { runtime, stories: new StoryRepository(runtime.client) }
}

describe('StoryRepository', () => {
  it('creates and updates reusable Story drafts', () => {
    const { runtime, stories } = setup()
    const schema = runtime.client.prepare("SELECT value FROM app_settings WHERE key = 'schema_version'").get() as { value: string }
    expect(schema.value).toBe('18')

    const created = stories.create({
      name: 'Story A',
      content: '{Xin chào|Hello}',
      mediaSourceType: 'folder',
      mediaPath: 'C:\\media\\story',
      folderMode: 'random',
      linkUrl: 'https://example.com',
      randomFont: true
    }, 1000)
    expect(created).toMatchObject({
      name: 'Story A',
      mediaSourceType: 'folder',
      folderMode: 'random',
      randomFont: true
    })

    const updated = stories.update({ ...created, name: 'Story B', content: 'B' }, 2000)
    expect(updated).toMatchObject({ id: created.id, name: 'Story B', content: 'B', updatedAt: 2000 })
    expect(stories.getByIds([created.id, 999999]).map((item) => item.id)).toEqual([created.id])
  })

  it('requires text when no media source is configured', () => {
    const { stories } = setup()
    expect(() => stories.create({ name: 'Empty' })).toThrow('nội dung chữ hoặc media')
  })
})
