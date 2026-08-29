import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from './index'
import { RunRepository } from './runRepository'
import { ScenarioGroupPostRunRepository } from './scenarioGroupPostRunRepository'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function createRuntime() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-k435-'))
  tempDirectories.push(directory)
  return initializeDatabase(join(directory, 'page-auto.sqlite'))
}

describe('ScenarioGroupPostRunRepository', () => {
  it('clones Scenario Group source into run_items with no Page Tab owner', () => {
    const runtime = createRuntime()
    const repository = new ScenarioGroupPostRunRepository(runtime.client)
    const created = repository.create({
      runKey: 'scenario-1:x10',
      name: 'Kịch Bản · Đăng bài nhóm',
      accountIds: [11, 22],
      groupUids: ['group-a', 'group-b', 'group-a'],
      variants: ['Nội dung A', 'Nội dung B'],
      postMode: 'sequential',
      image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' },
      postsPerAccount: 1,
      postDelayMinSeconds: 10,
      postDelayMaxSeconds: 20
    })

    expect(created.run.pageTabId).toBeNull()
    expect(created.run.pageUid).toBe('')
    expect(created.run.snapshot.pageTabId).toBe(0)
    expect(created.run.snapshot.accounts.map((item) => item.accountId)).toEqual([11, 22])
    expect(created.metrics).toMatchObject({ total: 2, pending: 2, processing: 0, success: 0 })

    const runs = new RunRepository(runtime.client)
    expect(runs.listItems(created.run.id).map((item) => ({ uid: item.groupUid, source: item.sourceGroupItemId }))).toEqual([
      { uid: 'group-a', source: null },
      { uid: 'group-b', source: null }
    ])

    runs.resume(created.run.id)
    const first = runs.claimNext(created.run.id)
    expect(first?.groupUid).toBe('group-a')
    runs.completeItem({ runId: created.run.id, itemId: first!.id, status: 'success' })
    const second = runs.claimNext(created.run.id)
    expect(second?.groupUid).toBe('group-b')
    expect(second?.id).not.toBe(first?.id)

    runtime.close()
  })

  it('keeps a multi-post Content Library snapshot while preserving Group run_items semantics', () => {
    const runtime = createRuntime()
    const repository = new ScenarioGroupPostRunRepository(runtime.client)
    const created = repository.create({
      runKey: 'scenario-2:x20',
      name: 'Kịch Bản · Đăng bài chung',
      accountIds: [33],
      groupUids: ['group-a', 'group-b'],
      variants: [],
      postMode: 'random',
      image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' },
      posts: [
        {
          name: 'Bài A',
          enabled: true,
          sortOrder: 0,
          variants: ['A1', 'A2'],
          image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
        },
        {
          name: 'Bài chỉ ảnh',
          enabled: true,
          sortOrder: 1,
          variants: [],
          image: { folderPath: 'D:\\media', mode: 'random', imagesPerPost: 2, missingPolicy: 'skip' }
        }
      ],
      postsPerAccount: 2,
      postDelayMinSeconds: 5,
      postDelayMaxSeconds: 10
    })

    expect(created.run.snapshot.postMode).toBe('random')
    expect(created.run.snapshot.posts).toEqual([
      expect.objectContaining({ name: 'Bài A', variants: ['A1', 'A2'] }),
      expect.objectContaining({ name: 'Bài chỉ ảnh', variants: [], image: expect.objectContaining({ folderPath: 'D:\\media' }) })
    ])
    expect(created.run.snapshot.contents).toEqual(['A1', 'A2'])
    expect(new RunRepository(runtime.client).listItems(created.run.id).map((item) => item.groupUid)).toEqual(['group-a', 'group-b'])

    runtime.close()
  })
})
