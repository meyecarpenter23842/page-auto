import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { StoryRecord } from '../../../../shared/story'
import {
  classifyStoryMediaUi,
  expandStorySpintax,
  resolveStoryMediaPath,
  STORY_POST_SELECTORS,
  waitForStoryCondition
} from './storyPostAction'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function story(patch: Partial<StoryRecord> = {}): StoryRecord {
  return {
    id: 1,
    name: 'Story',
    content: '',
    mediaSourceType: 'none',
    mediaPath: '',
    mediaKind: 'auto',
    folderMode: 'sequential',
    linkUrl: '',
    randomBackground: false,
    randomFont: false,
    createdAt: 1,
    updatedAt: 1,
    ...patch
  }
}

describe('StoryPostAction helpers', () => {
  it('expands one-level spintax deterministically for tests', () => {
    expect(expandStorySpintax('Xin {A|B} - {1|2}', () => 0)).toBe('Xin A - 1')
    expect(expandStorySpintax('Xin {A|B}', () => 0.99)).toBe('Xin B')
  })

  it('selects eligible folder media sequentially without deleting source files', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-auto-story-media-'))
    directories.push(directory)
    mkdirSync(join(directory, 'nested'))
    writeFileSync(join(directory, '01.jpg'), 'a')
    writeFileSync(join(directory, '02.mp4'), 'b')
    writeFileSync(join(directory, 'note.txt'), 'c')

    const input = story({ mediaSourceType: 'folder', mediaPath: directory, folderMode: 'sequential' })
    expect(await resolveStoryMediaPath(input, 0)).toBe(join(directory, '01.jpg'))
    expect(await resolveStoryMediaPath(input, 1)).toBe(join(directory, '02.mp4'))
  })

  it('honors the image/video filter for folder and file sources', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-auto-story-kind-'))
    directories.push(directory)
    writeFileSync(join(directory, '01.jpg'), 'a')
    writeFileSync(join(directory, '02.mp4'), 'b')

    const videos = story({ mediaSourceType: 'folder', mediaPath: directory, mediaKind: 'video' })
    expect(await resolveStoryMediaPath(videos, 0)).toBe(join(directory, '02.mp4'))

    const mismatchedFile = story({ mediaSourceType: 'file', mediaPath: join(directory, '01.jpg'), mediaKind: 'video' })
    expect(await resolveStoryMediaPath(mismatchedFile, 0)).toBeNull()
  })

  it('polls delayed Facebook UI readiness instead of failing on the first probe', async () => {
    let attempts = 0
    let clock = 0
    const result = await waitForStoryCondition(async () => {
      attempts += 1
      return attempts >= 4 ? 'ready' : null
    }, {
      timeoutMs: 1_000,
      intervalMs: 100,
      now: () => clock,
      sleep: async (delayMs) => { clock += delayMs }
    })

    expect(result).toBe('ready')
    expect(attempts).toBe(4)
  })

  it('times out delayed readiness deterministically', async () => {
    let clock = 0
    const result = await waitForStoryCondition(async () => null, {
      timeoutMs: 300,
      intervalMs: 100,
      now: () => clock,
      sleep: async (delayMs) => { clock += delayMs }
    })
    expect(result).toBeNull()
    expect(clock).toBe(300)
  })

  it('treats video trim as a blocking intermediate state before publish readiness', () => {
    expect(classifyStoryMediaUi(true, true, true)).toBe('trim')
    expect(classifyStoryMediaUi(false, true, false)).toBe('ready')
    expect(classifyStoryMediaUi(false, false, true)).toBe('ready')
    expect(classifyStoryMediaUi(false, false, false)).toBe('waiting')
  })

  it('covers the current Facebook Trim video labels and confirmation controls', () => {
    expect(STORY_POST_SELECTORS.trimSurface.join(' ')).toContain('Trim video')
    expect(STORY_POST_SELECTORS.trimConfirm.join(' ')).toMatch(/Done|Save|Confirm|Xong|Lưu/)
  })
})
