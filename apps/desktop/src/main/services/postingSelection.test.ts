import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RunItem, RunSnapshot } from '../../shared/runs'
import { selectRunContent, selectRunImages } from './postingSelection'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const snapshot: RunSnapshot = {
  version: 1,
  pageTabId: 1,
  tabName: 'Page A',
  pageUid: '90001',
  rotation: {
    postsPerAccount: 1,
    postDelayMinSeconds: 1,
    postDelayMaxSeconds: 2,
    accountDelayMinSeconds: 1,
    accountDelayMaxSeconds: 2
  },
  accounts: [{ accountId: 1, enabled: true, sortOrder: 0, postsPerTurn: null }],
  schedules: [],
  contentMode: 'sequential',
  contents: ['One', 'Two', 'Three'],
  image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' },
  groupSourceCount: 2
}

function item(sortOrder: number, groupUid = 'g1'): RunItem {
  return {
    id: sortOrder + 10,
    runId: 5,
    sourceGroupItemId: sortOrder + 1,
    groupUid,
    sortOrder,
    status: 'processing',
    attemptCount: 1,
    lastError: null,
    startedAt: 1,
    finishedAt: null,
    updatedAt: 1
  }
}

describe('posting selection', () => {
  it('selects sequential content by run item order', () => {
    expect(selectRunContent(snapshot, item(0))).toBe('One')
    expect(selectRunContent(snapshot, item(1))).toBe('Two')
    expect(selectRunContent(snapshot, item(3))).toBe('One')
  })

  it('keeps random content deterministic for the same item', () => {
    const randomSnapshot = { ...snapshot, contentMode: 'random' as const }
    expect(selectRunContent(randomSnapshot, item(7))).toBe(selectRunContent(randomSnapshot, item(7)))
  })

  it('selects images sequentially and reports missing count', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-auto-posting-images-'))
    tempDirectories.push(directory)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, '1.jpg'), 'a')
    writeFileSync(join(directory, '2.png'), 'b')
    writeFileSync(join(directory, 'ignore.txt'), 'c')

    const result = await selectRunImages({
      folderPath: directory,
      mode: 'sequential',
      imagesPerPost: 3,
      missingPolicy: 'skip'
    }, item(0))

    expect(result.paths).toHaveLength(2)
    expect(result.missing).toBe(true)
  })

  it('supports filename_match by group UID', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-auto-posting-match-'))
    tempDirectories.push(directory)
    writeFileSync(join(directory, 'g42-cover.jpg'), 'a')
    writeFileSync(join(directory, 'other.jpg'), 'b')

    const result = await selectRunImages({
      folderPath: directory,
      mode: 'filename_match',
      imagesPerPost: 1,
      missingPolicy: 'skip'
    }, item(0, 'g42'))

    expect(result.paths).toHaveLength(1)
    expect(result.paths[0]).toContain('g42-cover.jpg')
    expect(result.missing).toBe(false)
  })
})
