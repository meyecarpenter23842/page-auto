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
import { AccountRepository } from '../database/accountRepository'
import {
  CanonicalPostRepository,
  PageTabPostBindingRepository,
  ScenarioActionPostBindingRepository
} from '../database/canonicalPostRepository'
import { ContentLibraryRepository } from '../database/contentLibraryRepository'
import { initializeDatabase } from '../database'
import { PageTabRepository } from '../database/pageTabRepository'
import { RunRepository } from '../database/runRepository'
import { ScenarioRepository } from '../database/scenarioRepository'
import type { PostingService } from './postingService'
import { ScenarioPostActionAdapter } from './scenarioPostActionAdapter'

const tempDirectories: string[] = []
const runtimes: ReturnType<typeof initializeDatabase>[] = []

const textOnlyImage = {
  folderPath: '',
  mode: 'sequential' as const,
  imagesPerPost: 1,
  missingPolicy: 'text_only' as const
}

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close()
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function createRuntime(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  runtimes.push(runtime)
  return runtime
}

function createRunnablePage() {
  const runtime = createRuntime('page-auto-canonical-page-runtime-')
  const accounts = new AccountRepository(runtime.client)
  const tabs = new PageTabRepository(runtime.client)
  const runs = new RunRepository(runtime.client)
  const account = accounts.create({ uid: '10001', name: 'Runner' })
  const tab = tabs.create({ name: 'Page canonical', pageUid: '90001' })
  tabs.update(tab.id, {
    name: 'Page canonical',
    pageUid: '90001',
    rotation: {
      postsPerAccount: 1,
      postDelayMinSeconds: 0,
      postDelayMaxSeconds: 0,
      accountDelayMinSeconds: 0,
      accountDelayMaxSeconds: 0
    },
    accounts: [{ accountId: account.id, enabled: true, sortOrder: 0, postsPerTurn: null }],
    schedules: [],
    groupUids: ['group-a'],
    contentMode: 'sequential',
    contents: ['legacy page content'],
    image: textOnlyImage
  })
  return { runtime, tab, runs }
}

function createPostConfig(contentSetId: number): Record<string, unknown> {
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
    postDelayMaxSeconds: 0
  }
}

function createGroupPostConfig(content = ''): Record<string, unknown> {
  return {
    sourceTargets: 'group-a',
    content,
    postMode: 'sequential',
    postsPerAccount: 1,
    postDelayMinSeconds: 0,
    postDelayMaxSeconds: 0,
    imageFolderPath: '',
    imageMode: 'sequential',
    imagesPerPost: 1,
    missingPolicy: 'text_only'
  }
}

function createScenarioHarness() {
  const runtime = createRuntime('page-auto-canonical-scenario-runtime-')
  const runs = new RunRepository(runtime.client)
  let wallInput: PageWallExecutionInput | null = null
  let groupRunId: number | null = null

  const posting = {
    executePageWallPostNow: async (input: PageWallExecutionInput): Promise<PostingJobResult> => {
      wallInput = { ...input, imagePaths: [...input.imagePaths] }
      return { status: 'success', message: 'wall ok' }
    },
    executeSingle: async (payload: ExecuteSinglePostingJobPayload): Promise<ExecuteSinglePostingJobResult> => {
      groupRunId = payload.runId
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
    runs,
    canonical: new CanonicalPostRepository(runtime.client),
    scenarioBindings: new ScenarioActionPostBindingRepository(runtime.client),
    library: new ContentLibraryRepository(runtime.client),
    scenarios: new ScenarioRepository(runtime.client),
    adapter: new ScenarioPostActionAdapter(runtime.client, posting),
    lastWallInput: () => wallInput,
    lastGroupRunId: () => groupRunId
  }
}

describe('canonical post runtime cutover', () => {
  it('uses Page canonical bindings first and freezes the resolved snapshot at Start', () => {
    const { runtime, tab, runs } = createRunnablePage()
    const canonical = new CanonicalPostRepository(runtime.client)
    const bindings = new PageTabPostBindingRepository(runtime.client)
    const post = canonical.create({
      name: 'Canonical Page post',
      variants: ['canonical base'],
      image: textOnlyImage
    })
    bindings.bindExisting(tab.id, post.id)
    bindings.updateOverrides(tab.id, post.id, { variants: ['canonical page override'] })

    const created = runs.createForPageTab(tab.id)
    expect(created.run.snapshot.posts?.map((item) => item.variants)).toEqual([['canonical page override']])
    expect(created.run.snapshot.posts?.[0]?.name).toBe('Canonical Page post')

    bindings.updateOverrides(tab.id, post.id, { variants: ['changed after Start'] })
    bindings.unlink(tab.id, post.id)

    expect(runs.get(created.run.id)?.run.snapshot.posts?.[0]?.variants).toEqual(['canonical page override'])
  })

  it('keeps Page legacy post storage as fallback when no canonical binding exists', () => {
    const { tab, runs } = createRunnablePage()
    const created = runs.createForPageTab(tab.id)
    expect(created.run.snapshot.posts?.[0]?.variants).toEqual(['legacy page content'])
  })

  it('uses Scenario post bindings even if the legacy Content Set is deleted, and freezes before execution', async () => {
    const { canonical, scenarioBindings, library, scenarios, adapter, lastWallInput } = createScenarioHarness()
    const set = library.createSet({ name: 'Legacy source' })
    library.createItem({
      contentSetId: set.id,
      name: 'Legacy item',
      enabled: true,
      variants: ['legacy scenario content'],
      image: textOnlyImage
    })
    const scenario = scenarios.create({ name: 'Canonical scenario post' })
    const details = scenarios.createAction({
      scenarioId: scenario.id,
      actionType: 'post',
      label: 'Đăng bài',
      category: 'publishing',
      configJson: JSON.stringify(createPostConfig(set.id))
    })
    const action = details.actions[0]!
    const post = canonical.create({
      name: 'Canonical Scenario post',
      variants: ['canonical scenario at Start'],
      image: textOnlyImage
    })
    scenarioBindings.bindExisting(action.id, post.id)
    library.deleteSet(set.id)

    const prepared = adapter.prepareScenarioRun([scenario.id])
    expect(prepared.actions.get(action.id)?.posts[0]?.variants).toEqual(['canonical scenario at Start'])

    canonical.update(post.id, {
      name: post.name,
      variants: ['canonical scenario changed later'],
      image: textOnlyImage
    })
    adapter.beginScenarioRun('scenario-canonical-post', [1], prepared)

    const job = {
      accountId: 1,
      request: {
        runKey: 'scenario-canonical-post:a1:r0',
        scenarioActionId: action.id,
        actionType: 'post',
        label: 'Đăng bài',
        actor: { kind: 'profile', accountId: 1, accountUid: 'uid-1' },
        config: createPostConfig(set.id)
      }
    } as unknown as ScenarioActionWorkerJob
    const result = await adapter.run(job)

    expect(result.summary.result.status).toBe('success')
    expect(lastWallInput()?.content).toBe('canonical scenario at Start')
    adapter.finishScenarioRun('scenario-canonical-post')
  })

  it('runs legacy group_post from its canonical Start snapshot without depending on inline content', async () => {
    const {
      runs,
      canonical,
      scenarioBindings,
      scenarios,
      adapter,
      lastGroupRunId
    } = createScenarioHarness()
    const scenario = scenarios.create({ name: 'Canonical legacy group_post' })
    const details = scenarios.createAction({
      scenarioId: scenario.id,
      actionType: 'group_post',
      label: 'Đăng nhóm legacy',
      category: 'publishing',
      configJson: JSON.stringify(createGroupPostConfig('legacy inline content'))
    })
    const action = details.actions[0]!
    const post = canonical.create({
      name: 'Canonical Group post',
      variants: ['canonical group at Start'],
      image: textOnlyImage
    })
    scenarioBindings.bindExisting(action.id, post.id)

    const prepared = adapter.prepareScenarioRun([scenario.id])
    expect(prepared.groupActions?.get(action.id)?.posts[0]?.variants).toEqual(['canonical group at Start'])
    canonical.update(post.id, {
      name: post.name,
      variants: ['canonical group changed later'],
      image: textOnlyImage
    })
    adapter.beginScenarioRun('scenario-canonical-group', [1], prepared)

    const job = {
      accountId: 1,
      request: {
        runKey: 'scenario-canonical-group:a1:r0',
        scenarioActionId: action.id,
        actionType: 'group_post',
        label: 'Đăng nhóm legacy',
        actor: { kind: 'profile', accountId: 1, accountUid: 'uid-1' },
        // Empty inline content proves the canonical execution path no longer
        // consumes legacy content/media fields once a binding snapshot exists.
        config: createGroupPostConfig('')
      }
    } as unknown as ScenarioActionWorkerJob
    const result = await adapter.run(job)

    expect(result.summary.result.status).toBe('success')
    expect(result.summary.normalizedConfig?.content).toBe('')
    const groupRunId = lastGroupRunId()
    expect(groupRunId).not.toBeNull()
    expect(runs.get(groupRunId!)?.run.snapshot.posts?.[0]?.variants).toEqual(['canonical group at Start'])
    adapter.finishScenarioRun('scenario-canonical-group')
  })
})
