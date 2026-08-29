import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PageWallExecutionInput } from '../../shared/pageWall'
import type {
  ExecuteSinglePostingJobPayload,
  ExecuteSinglePostingJobResult,
  PostingJobResult
} from '../../shared/posting'
import type { ScenarioActionWorkerJob } from '../../shared/scenarioActionWorker'
import { initializeDatabase } from '../database'
import { ContentLibraryRepository } from '../database/contentLibraryRepository'
import { RunRepository } from '../database/runRepository'
import { ScenarioRepository } from '../database/scenarioRepository'
import type { PostingService } from './postingService'
import { ScenarioPostActionAdapter } from './scenarioPostActionAdapter'

const tempDirectories: string[] = []
const runtimes: ReturnType<typeof initializeDatabase>[] = []

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close()
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-k452-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  runtimes.push(runtime)
  const runs = new RunRepository(runtime.client)
  let wallCalls = 0
  let groupCalls = 0
  let wallResult: PostingJobResult = { status: 'success', message: 'wall ok' }
  const posting = {
    executePageWallPostNow: async (_input: PageWallExecutionInput): Promise<PostingJobResult> => {
      wallCalls += 1
      return { ...wallResult }
    },
    executeSingle: async (payload: ExecuteSinglePostingJobPayload): Promise<ExecuteSinglePostingJobResult> => {
      groupCalls += 1
      let details = runs.get(payload.runId)
      if (!details) throw new Error('missing group run')
      if (details.run.status === 'created') details = runs.resume(payload.runId)
      const item = runs.claimNext(payload.runId)
      if (!item) {
        return {
          accountId: payload.accountId ?? null,
          item: null,
          result: { status: 'failed', code: 'no_pending_item', message: 'no pending' },
          run: runs.get(payload.runId)!
        }
      }
      const completed = runs.completeItem({ runId: payload.runId, itemId: item.id, status: 'success' })
      return {
        accountId: payload.accountId ?? null,
        item,
        result: { status: 'success', message: 'group ok' },
        run: completed
      }
    },
    releaseAccount: async (_accountId: number): Promise<void> => undefined,
    closeAll: (): void => undefined
  } as unknown as PostingService

  return {
    runtime,
    library: new ContentLibraryRepository(runtime.client),
    scenarios: new ScenarioRepository(runtime.client),
    adapter: new ScenarioPostActionAdapter(runtime.client, posting),
    setWallResult: (result: PostingJobResult) => { wallResult = result },
    calls: () => ({ wallCalls, groupCalls })
  }
}

function createScenarioConfig(contentSetId: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contentSetId,
    selectionMode: 'sequential',
    postToWall: true,
    wallPageUid: '90001',
    wallPostsPerAccount: 1,
    postToGroups: false,
    groupTargets: '',
    groupPostsPerAccount: 1,
    postDelayMinSeconds: 0,
    postDelayMaxSeconds: 0,
    ...overrides
  }
}

function createPostAction(
  scenarios: ScenarioRepository,
  contentSetId: number,
  overrides: Record<string, unknown> = {}
) {
  const scenario = scenarios.create({ name: 'KB K4.5.2' })
  const details = scenarios.createAction({
    scenarioId: scenario.id,
    actionType: 'post',
    label: 'Đăng bài',
    category: 'publishing',
    configJson: JSON.stringify(createScenarioConfig(contentSetId, overrides))
  })
  return { scenario, action: details.actions[0]! }
}

describe('ScenarioPostActionAdapter', () => {
  it('resolves only the global Content Library before Start and keeps a detached snapshot after edit/delete', () => {
    const { library, scenarios, adapter } = setup()
    const set = library.createSet({ name: 'Nguồn chung' })
    library.createItem({
      contentSetId: set.id,
      name: 'Bài A',
      enabled: true,
      variants: ['A ban đầu'],
      image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
    })
    const { scenario } = createPostAction(scenarios, set.id)

    const prepared = adapter.prepareScenarioRun([scenario.id])
    expect([...prepared.actions.values()][0]).toMatchObject({
      contentSetId: set.id,
      contentSetName: 'Nguồn chung',
      posts: [expect.objectContaining({ variants: ['A ban đầu'] })]
    })

    const current = library.get(set.id)!
    library.updateItem({
      id: current.items[0]!.id,
      name: 'Bài A sửa',
      enabled: true,
      variants: ['A đã sửa'],
      image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
    })
    library.deleteSet(set.id)

    expect([...prepared.actions.values()][0]?.posts[0]?.variants).toEqual(['A ban đầu'])
    expect(() => adapter.prepareScenarioRun([scenario.id])).toThrow('không tồn tại trong Thư viện chung trước khi Start')
  })

  it('keeps Wall and Group results independent when both targets are enabled', async () => {
    const { library, scenarios, adapter, setWallResult, calls } = setup()
    const set = library.createSet({ name: 'Nguồn partial' })
    library.createItem({
      contentSetId: set.id,
      name: 'Bài A',
      enabled: true,
      variants: ['Nội dung snapshot'],
      image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
    })
    const { scenario, action } = createPostAction(scenarios, set.id, {
      postToGroups: true,
      groupTargets: 'group-a'
    })
    setWallResult({ status: 'failed', code: 'publish_unconfirmed', message: 'wall failed' })
    const prepared = adapter.prepareScenarioRun([scenario.id])
    adapter.beginScenarioRun('scenario-test', [1], prepared)

    const job = {
      accountId: 1,
      request: {
        runKey: 'scenario-test:a1:r0',
        scenarioActionId: action.id,
        actionType: 'post',
        label: 'Đăng bài',
        actor: { kind: 'profile', accountId: 1, accountUid: 'uid-1' },
        config: createScenarioConfig(set.id, { postToGroups: true, groupTargets: 'group-a' })
      }
    } as unknown as ScenarioActionWorkerJob
    const result = await adapter.run(job)
    const targets = result.summary.result.data?.targets as Record<string, { status: string }> | undefined

    expect(result.summary.result.status).toBe('failed')
    expect(result.summary.result.code).toBe('post_partial_failure')
    expect(targets?.wall?.status).toBe('failed')
    expect(targets?.group?.status).toBe('success')
    expect(calls()).toEqual({ wallCalls: 1, groupCalls: 1 })

    adapter.finishScenarioRun('scenario-test')
  })
})
