import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cloneDefaultAppSettings } from '../../shared/appSettings'
import type { FacebookPostTaskJobRequest } from '../../shared/facebookTasks'
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
  const wallJobs: FacebookPostTaskJobRequest[] = []
  const posting = {
    executeFacebookPostTask: async (job: FacebookPostTaskJobRequest): Promise<PostingJobResult> => {
      wallCalls += 1
      wallJobs.push(job)
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
    calls: () => ({ wallCalls, groupCalls }),
    wallJobs
  }
}

function createScenarioConfig(contentSetId: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contentSetId,
    selectionMode: 'sequential',
    postToWall: true,
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

function workerJob(actionId: number, config: Record<string, unknown>): ScenarioActionWorkerJob {
  const settings = cloneDefaultAppSettings()
  return {
    accountId: 1,
    profileDirectory: 'C:\\PageAuto\\profiles\\uid-1',
    browser: settings.browser,
    session: settings.session,
    network: settings.network,
    sessionAccount: {
      id: 1,
      uid: 'uid-1',
      username: null,
      password: null,
      cookie: 'c_user=uid-1',
      twoFactorSecret: null,
      name: null
    },
    request: {
      runKey: 'scenario-test:a1:r0',
      scenarioActionId: actionId,
      actionType: 'post',
      label: 'Đăng bài',
      actor: { kind: 'profile', accountId: 1, accountUid: 'uid-1' },
      config
    }
  }
}

function addPost(library: ContentLibraryRepository, name = 'Nguồn chung') {
  const set = library.createSet({ name })
  library.createItem({
    contentSetId: set.id,
    name: 'Bài A',
    enabled: true,
    variants: ['Nội dung snapshot'],
    image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
  })
  return set
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

  it('runs Wall and Group inside the same Đăng bài action while Wall stays on the running profile', async () => {
    const { library, scenarios, adapter, setWallResult, calls, wallJobs } = setup()
    const set = addPost(library, 'Nguồn composite')
    const config = createScenarioConfig(set.id, {
      postToWall: true,
      wallPageUid: 'legacy-page-must-be-ignored',
      wallPostsPerAccount: 1,
      postToGroups: true,
      groupTargets: 'group-a',
      groupPostsPerAccount: 1
    })
    const { scenario, action } = createPostAction(scenarios, set.id, config)
    setWallResult({ status: 'failed', code: 'publish_unconfirmed', message: 'wall failed' })
    const prepared = adapter.prepareScenarioRun([scenario.id])
    adapter.beginScenarioRun('scenario-test', [1], prepared)

    const result = await adapter.run(workerJob(action.id, config))
    const targets = result.summary.result.data?.targets as Record<string, { status: string }> | undefined

    expect(result.summary.result.status).toBe('failed')
    expect(result.summary.result.code).toBe('post_partial_failure')
    expect(targets?.wall?.status).toBe('failed')
    expect(targets?.group?.status).toBe('success')
    expect(calls()).toEqual({ wallCalls: 1, groupCalls: 1 })
    expect(result.summary.normalizedConfig).toMatchObject({
      postToWall: true,
      wallPostsPerAccount: 1,
      postToGroups: true,
      groupTargets: 'group-a',
      groupPostsPerAccount: 1
    })
    expect(result.summary.normalizedConfig).not.toHaveProperty('wallPageUid')
    expect(wallJobs).toHaveLength(1)
    expect(wallJobs[0]?.pageUid).toBe('')
    expect(wallJobs[0]?.task).toEqual({
      type: 'page_wall_post',
      target: { kind: 'page_wall', pageUid: 'uid-1' }
    })

    adapter.finishScenarioRun('scenario-test')
  })

  it('does not start Group when Wall reports login or verification attention', async () => {
    const wallResults: PostingJobResult[] = [
      { status: 'needs_login', code: 'needs_login', message: 'login required' },
      {
        status: 'failed',
        code: 'verification_required',
        message: 'verification required',
        sessionValidation: {
          phase: 'after_run',
          state: 'verification_required',
          message: 'verification required'
        }
      }
    ]

    for (const [index, wallResult] of wallResults.entries()) {
      const { library, scenarios, adapter, setWallResult, calls } = setup()
      const set = addPost(library, `Nguồn attention ${index}`)
      const config = createScenarioConfig(set.id, {
        postToWall: true,
        postToGroups: true,
        groupTargets: 'group-must-not-run',
        groupPostsPerAccount: 1
      })
      const { scenario, action } = createPostAction(scenarios, set.id, config)
      setWallResult(wallResult)
      const prepared = adapter.prepareScenarioRun([scenario.id])
      adapter.beginScenarioRun('scenario-test', [1], prepared)

      const result = await adapter.run(workerJob(action.id, config))
      const targets = result.summary.result.data?.targets as Record<string, { status: string }> | undefined

      expect(result.summary.result.status).toBe('needs_attention')
      expect(targets?.wall?.status).toBe('needs_attention')
      expect(targets?.group).toBeUndefined()
      expect(calls()).toEqual({ wallCalls: 1, groupCalls: 0 })

      adapter.finishScenarioRun('scenario-test')
    }
  })

  it('supports Group-only Đăng bài without invoking the wall executor', async () => {
    const { library, scenarios, adapter, calls, wallJobs } = setup()
    const set = addPost(library, 'Nguồn group only')
    const config = createScenarioConfig(set.id, {
      postToWall: false,
      postToGroups: true,
      groupTargets: 'group-only',
      groupPostsPerAccount: 1
    })
    const { scenario, action } = createPostAction(scenarios, set.id, config)
    const prepared = adapter.prepareScenarioRun([scenario.id])
    adapter.beginScenarioRun('scenario-test', [1], prepared)

    const result = await adapter.run(workerJob(action.id, config))
    const targets = result.summary.result.data?.targets as Record<string, { status: string }> | undefined

    expect(result.summary.result.status).toBe('success')
    expect(targets?.wall).toBeUndefined()
    expect(targets?.group?.status).toBe('success')
    expect(calls()).toEqual({ wallCalls: 0, groupCalls: 1 })
    expect(wallJobs).toHaveLength(0)

    adapter.finishScenarioRun('scenario-test')
  })
})
