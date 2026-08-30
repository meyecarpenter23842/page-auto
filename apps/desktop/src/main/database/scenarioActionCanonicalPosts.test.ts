import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../database'
import { CanonicalPostRepository } from './canonicalPostRepository'
import { ScenarioRepository } from './scenarioRepository'

const directories: string[] = []
const runtimes: ReturnType<typeof initializeDatabase>[] = []

function runtime(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  directories.push(directory)
  const value = initializeDatabase(join(directory, 'page-auto.sqlite'))
  runtimes.push(value)
  return value
}

function textPost(name: string, text: string, postId: number | null = null) {
  return {
    postId,
    name,
    enabled: true,
    sortOrder: 0,
    variants: [text],
    image: { folderPath: '', mode: 'random' as const, imagesPerPost: 1, missingPolicy: 'text_only' as const }
  }
}

afterEach(() => {
  for (const value of runtimes.splice(0)) value.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('scenario canonical post bindings', () => {
  it('creates a canonical post with one action and reuses the same identity from another action', () => {
    const db = runtime('page-auto-scenario-canonical-')
    const scenarios = new ScenarioRepository(db.client)
    const canonical = new CanonicalPostRepository(db.client)
    const scenario = scenarios.create({ name: 'Scenario canonical' })

    let details = scenarios.createAction({
      scenarioId: scenario.id,
      actionType: 'post',
      label: 'Đăng bài',
      category: 'publishing',
      configJson: '{}',
      posts: [textPost('Bài dùng chung', 'Nội dung dùng chung')]
    })

    const firstAction = details.actions[0]!
    const postId = firstAction.posts?.[0]?.postId
    expect(postId).toBeTypeOf('number')
    expect(canonical.list()).toHaveLength(1)

    details = scenarios.createAction({
      scenarioId: scenario.id,
      actionType: 'group_post',
      label: 'Đăng bài nhóm',
      category: 'groups',
      configJson: '{}',
      posts: [textPost('Bài dùng chung', 'Nội dung dùng chung', postId!)]
    })

    expect(details.actions).toHaveLength(2)
    expect(details.actions[0]!.posts?.[0]?.postId).toBe(postId)
    expect(details.actions[1]!.posts?.[0]?.postId).toBe(postId)
    expect(canonical.list()).toHaveLength(1)
  })

  it('unlinks from one action without deleting the canonical post or the other action binding', () => {
    const db = runtime('page-auto-scenario-unlink-')
    const scenarios = new ScenarioRepository(db.client)
    const canonical = new CanonicalPostRepository(db.client)
    const scenario = scenarios.create({ name: 'Scenario unlink' })

    let details = scenarios.createAction({
      scenarioId: scenario.id,
      actionType: 'post',
      label: 'Đăng bài A',
      category: 'publishing',
      posts: [textPost('Bài gốc', 'Text gốc')]
    })
    const firstAction = details.actions[0]!
    const postId = firstAction.posts![0]!.postId

    details = scenarios.createAction({
      scenarioId: scenario.id,
      actionType: 'post',
      label: 'Đăng bài B',
      category: 'publishing',
      posts: [textPost('Bài gốc', 'Text gốc', postId)]
    })
    const secondAction = details.actions[1]!

    details = scenarios.updateAction({ id: firstAction.id, patch: {}, posts: [] })
    expect(details.actions.find((action) => action.id === firstAction.id)?.posts).toEqual([])
    expect(details.actions.find((action) => action.id === secondAction.id)?.posts?.[0]?.postId).toBe(postId)
    expect(canonical.get(postId)?.name).toBe('Bài gốc')
  })

  it('rolls back action creation when the new canonical post is invalid', () => {
    const db = runtime('page-auto-scenario-rollback-')
    const scenarios = new ScenarioRepository(db.client)
    const canonical = new CanonicalPostRepository(db.client)
    const scenario = scenarios.create({ name: 'Scenario rollback' })

    expect(() => scenarios.createAction({
      scenarioId: scenario.id,
      actionType: 'post',
      label: 'Đăng bài lỗi',
      category: 'publishing',
      posts: [{
        postId: null,
        name: 'Bài rỗng',
        enabled: true,
        sortOrder: 0,
        variants: [],
        image: { folderPath: '', mode: 'random', imagesPerPost: 1, missingPolicy: 'text_only' }
      }]
    })).toThrow(/nội dung hoặc folder ảnh/i)

    expect(scenarios.get(scenario.id)?.actions).toHaveLength(0)
    expect(canonical.list()).toHaveLength(0)
  })
})
