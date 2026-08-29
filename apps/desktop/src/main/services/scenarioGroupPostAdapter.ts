import type Database from 'better-sqlite3'
import { validateActionConfig, type ActionConfig, type ActionResult } from '../../shared/actionRegistry'
import type { ActionLogEvent } from '../../shared/actionRuntime'
import { parsePostVariantText, type ImageMode, type MissingImagePolicy, type PostSelectionMode } from '../../shared/pageTabs'
import type { ExecuteSinglePostingJobResult } from '../../shared/posting'
import type { RunSnapshotPost } from '../../shared/runs'
import type { ScenarioActionWorkerJob, ScenarioActionWorkerResult } from '../../shared/scenarioActionWorker'
import {
  applyK435GroupPostActionOverrides,
  getK435ValidationErrors
} from '../../shared/k435GroupPostActionOverrides'
import { RunRepository } from '../database/runRepository'
import { ScenarioGroupPostRunRepository } from '../database/scenarioGroupPostRunRepository'
import { PostingService } from './postingService'

interface ScenarioGroupPostScope {
  accountIds: number[]
  postingRunIds: Map<number, number>
  cancelledRunKeys: Set<string>
}

export interface ScenarioGroupPostSnapshotInput {
  groupTargets: string
  posts: RunSnapshotPost[]
  postMode: PostSelectionMode
  postsPerAccount: number
  postDelayMinSeconds: number
  postDelayMaxSeconds: number
}

interface ResolvedGroupPostInput {
  groups: string[]
  posts: RunSnapshotPost[]
  postMode: PostSelectionMode
  postsPerAccount: number
  postDelayMinSeconds: number
  postDelayMaxSeconds: number
}

function numberConfig(config: ActionConfig, key: string, fallback: number): number {
  const value = config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringConfig(config: ActionConfig, key: string, fallback = ''): string {
  const value = config[key]
  return typeof value === 'string' ? value : fallback
}

function groupUidFromTarget(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null
  const candidate = /^(?:www\.)?facebook\.com\//i.test(raw) ? `https://${raw}` : raw
  try {
    const url = new URL(candidate)
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return null
    const parts = url.pathname.split('/').filter(Boolean)
    const groupsIndex = parts.findIndex((part) => part.toLowerCase() === 'groups')
    const uid = groupsIndex >= 0 ? parts[groupsIndex + 1]?.trim() : ''
    return uid || null
  } catch {
    const direct = raw.replace(/^\/+|\/+$/g, '')
    return direct && !direct.includes('/') && !/\s/.test(direct) ? direct : null
  }
}

export function normalizeScenarioGroupTargets(value: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const line of value.split(/\r?\n/)) {
    const uid = groupUidFromTarget(line)
    if (!uid || seen.has(uid)) continue
    seen.add(uid)
    result.push(uid)
  }
  return result
}

function normalizeSnapshotPosts(posts: readonly RunSnapshotPost[]): RunSnapshotPost[] {
  return posts
    .filter((post) => post.enabled)
    .map((post, index) => ({
      name: post.name.trim() || `Bài viết ${index + 1}`,
      enabled: true,
      sortOrder: index,
      variants: post.variants.map((variant) => variant.trim()).filter(Boolean),
      image: { ...post.image, folderPath: post.image.folderPath.trim() }
    }))
    .filter((post) => post.variants.length > 0 || post.image.folderPath.length > 0)
}

function scenarioRunIdFromRunKey(runKey: string): string {
  const marker = runKey.indexOf(':a')
  return marker > 0 ? runKey.slice(0, marker) : runKey
}

function attentionSessionState(outcome: ExecuteSinglePostingJobResult): ScenarioActionWorkerResult['sessionState'] {
  const state = outcome.result.sessionValidation?.state
  if (state === 'needs_login' || state === 'verification_required') return state
  return outcome.result.status === 'needs_login' ? 'needs_login' : null
}

function actionResultFromPosting(outcome: ExecuteSinglePostingJobResult): ActionResult {
  const postingResult = outcome.result
  if (postingResult.code === 'no_pending_item') {
    return { status: 'skipped', code: 'group_post_snapshot_exhausted', message: 'Snapshot Group của action đã hết item chờ.' }
  }
  if (postingResult.status === 'needs_login') {
    return { status: 'needs_attention', code: postingResult.code ?? 'needs_login', message: postingResult.message }
  }
  if (postingResult.status === 'failed') {
    return {
      status: 'failed',
      message: postingResult.message,
      ...(postingResult.code ? { code: postingResult.code } : {})
    }
  }
  if (postingResult.status === 'skipped') {
    return {
      status: 'skipped',
      message: postingResult.message,
      ...(postingResult.code ? { code: postingResult.code } : {})
    }
  }
  return {
    status: 'success',
    code: 'group_post_published',
    message: postingResult.message,
    ...(postingResult.publishedUrl ? { data: { publishedUrl: postingResult.publishedUrl } } : {})
  }
}

function workerResult(
  normalizedConfig: ActionConfig | null,
  actionResult: ActionResult,
  startedAt: number,
  attempts: number,
  state: ScenarioActionWorkerResult['sessionState'] = null
): ScenarioActionWorkerResult {
  return {
    summary: {
      result: actionResult,
      normalizedConfig,
      attempts,
      startedAt,
      finishedAt: Date.now()
    },
    sessionCookie: null,
    accountName: null,
    sessionState: state
  }
}

export class ScenarioGroupPostAdapter {
  private readonly snapshots: ScenarioGroupPostRunRepository
  private readonly runs: RunRepository
  private readonly scopes = new Map<string, ScenarioGroupPostScope>()

  constructor(
    database: Database.Database,
    private readonly posting: PostingService
  ) {
    applyK435GroupPostActionOverrides()
    this.snapshots = new ScenarioGroupPostRunRepository(database)
    this.runs = new RunRepository(database)
  }

  handles(actionType: string): boolean {
    return actionType === 'group_post'
  }

  beginScenarioRun(runId: string, accountIds: readonly number[]): void {
    for (const staleRunId of [...this.scopes.keys()]) this.finishScenarioRun(staleRunId)
    this.scopes.set(runId, {
      accountIds: [...new Set(accountIds.filter((id) => Number.isSafeInteger(id) && id > 0))],
      postingRunIds: new Map(),
      cancelledRunKeys: new Set()
    })
  }

  async run(job: ScenarioActionWorkerJob, onLog?: (event: ActionLogEvent) => void): Promise<ScenarioActionWorkerResult> {
    const startedAt = Date.now()
    const validation = validateActionConfig('group_post', job.request.config)
    const extraErrors = getK435ValidationErrors('group_post', validation.value)
    if (!validation.valid || extraErrors.length) {
      const errors = [...validation.errors, ...extraErrors]
      return workerResult(validation.value, {
        status: 'failed',
        code: 'action_config_invalid',
        message: errors.join(' ')
      }, startedAt, 0)
    }
    const config = validation.value
    const groups = normalizeScenarioGroupTargets(stringConfig(config, 'sourceTargets'))
    const variants = parsePostVariantText(stringConfig(config, 'content'))
    if (!groups.length || !variants.length) {
      return workerResult(config, {
        status: 'failed',
        code: 'action_config_invalid',
        message: !groups.length ? 'Không có Group UID hợp lệ sau khi chuẩn hóa.' : 'Không có nội dung hợp lệ sau khi tách biến thể.'
      }, startedAt, 0)
    }

    const postMode = stringConfig(config, 'postMode', 'sequential') as PostSelectionMode
    const imageMode = stringConfig(config, 'imageMode', 'sequential') as ImageMode
    const missingPolicy = stringConfig(config, 'missingPolicy', 'text_only') as MissingImagePolicy
    return this.runResolved(job, config, {
      groups,
      posts: [{
        name: 'Scenario group_post',
        enabled: true,
        sortOrder: 0,
        variants,
        image: {
          folderPath: stringConfig(config, 'imageFolderPath'),
          mode: imageMode,
          imagesPerPost: Math.max(1, Math.floor(numberConfig(config, 'imagesPerPost', 1))),
          missingPolicy
        }
      }],
      postMode,
      postsPerAccount: Math.max(1, Math.floor(numberConfig(config, 'postsPerAccount', 1))),
      postDelayMinSeconds: numberConfig(config, 'postDelayMinSeconds', 0),
      postDelayMaxSeconds: numberConfig(config, 'postDelayMaxSeconds', 0)
    }, onLog, startedAt)
  }

  async runWithSnapshot(
    job: ScenarioActionWorkerJob,
    input: ScenarioGroupPostSnapshotInput,
    onLog?: (event: ActionLogEvent) => void
  ): Promise<ScenarioActionWorkerResult> {
    const startedAt = Date.now()
    const groups = normalizeScenarioGroupTargets(input.groupTargets)
    const posts = normalizeSnapshotPosts(input.posts)
    if (!groups.length || !posts.length) {
      return workerResult(null, {
        status: 'failed',
        code: 'action_config_invalid',
        message: !groups.length
          ? 'Không có Group UID hợp lệ sau khi chuẩn hóa.'
          : 'Snapshot Thư viện chung không có bài viết hợp lệ.'
      }, startedAt, 0)
    }
    return this.runResolved(job, null, {
      groups,
      posts,
      postMode: input.postMode,
      postsPerAccount: Math.max(1, Math.floor(input.postsPerAccount)),
      postDelayMinSeconds: Math.max(0, input.postDelayMinSeconds),
      postDelayMaxSeconds: Math.max(0, input.postDelayMaxSeconds)
    }, onLog, startedAt)
  }

  private async runResolved(
    job: ScenarioActionWorkerJob,
    normalizedConfig: ActionConfig | null,
    input: ResolvedGroupPostInput,
    onLog: ((event: ActionLogEvent) => void) | undefined,
    startedAt: number
  ): Promise<ScenarioActionWorkerResult> {
    const scenarioRunId = scenarioRunIdFromRunKey(job.request.runKey)
    const scope = this.scopes.get(scenarioRunId)
    if (!scope) {
      return workerResult(null, {
        status: 'failed',
        code: 'group_post_scope_missing',
        message: 'Scenario group_post chưa được khởi tạo snapshot scope.'
      }, startedAt, 0)
    }

    const scenarioActionId = job.request.scenarioActionId
    if (typeof scenarioActionId !== 'number' || !Number.isSafeInteger(scenarioActionId) || scenarioActionId <= 0) {
      return workerResult(normalizedConfig, {
        status: 'failed',
        code: 'group_post_action_id_missing',
        message: 'Scenario group_post cần scenarioActionId để sở hữu một snapshot duy nhất.'
      }, startedAt, 0)
    }

    let postingRunId = scope.postingRunIds.get(scenarioActionId)
    if (!postingRunId) {
      const firstPost = input.posts[0]
      const created = this.snapshots.create({
        runKey: `${scenarioRunId}:x${scenarioActionId}`,
        name: `Kịch Bản · ${job.request.label}`,
        accountIds: scope.accountIds,
        groupUids: input.groups,
        variants: input.posts.flatMap((post) => post.variants),
        postMode: input.postMode,
        image: firstPost?.image ?? { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' },
        posts: input.posts,
        postsPerAccount: input.postsPerAccount,
        postDelayMinSeconds: input.postDelayMinSeconds,
        postDelayMaxSeconds: input.postDelayMaxSeconds
      })
      postingRunId = created.run.id
      scope.postingRunIds.set(scenarioActionId, postingRunId)
      this.emit(job, onLog, 'executing', 'info', `Đã tạo snapshot Group #${postingRunId}: ${created.metrics.total} Group, ${input.posts.length} bài viết.`)
    }

    const postsPerAccount = input.postsPerAccount
    const delayMin = input.postDelayMinSeconds
    const delayMax = input.postDelayMaxSeconds
    let attempts = 0
    let success = 0
    let skipped = 0
    let lastOutcome: ExecuteSinglePostingJobResult | null = null

    for (let index = 0; index < postsPerAccount; index += 1) {
      if (scope.cancelledRunKeys.has(job.request.runKey)) {
        return workerResult(normalizedConfig, { status: 'stopped', code: 'action_stopped', message: 'Đăng bài nhóm đã dừng theo yêu cầu.' }, startedAt, attempts)
      }

      attempts += 1
      const outcome = await this.posting.executeSingle({ runId: postingRunId, accountId: job.accountId })
      lastOutcome = outcome
      const mapped = actionResultFromPosting(outcome)
      const groupLabel = outcome.item?.groupUid ? `Group ${outcome.item.groupUid}` : 'Snapshot Group'
      this.emit(
        job,
        onLog,
        'executing',
        mapped.status === 'failed' || mapped.status === 'needs_attention' ? 'warning' : 'info',
        `${groupLabel}: ${mapped.message ?? mapped.status}`,
        mapped.code
      )

      if (mapped.status === 'success') success += 1
      else if (mapped.status === 'skipped') {
        skipped += 1
        if (mapped.code === 'group_post_snapshot_exhausted') break
      } else {
        return workerResult(normalizedConfig, mapped, startedAt, attempts, attentionSessionState(outcome))
      }

      if (index + 1 < postsPerAccount && !scope.cancelledRunKeys.has(job.request.runKey)) {
        const delayMs = this.randomDelayMs(delayMin, delayMax)
        if (delayMs > 0 && !await this.sleep(scope, job.request.runKey, delayMs)) {
          return workerResult(normalizedConfig, { status: 'stopped', code: 'action_stopped', message: 'Đăng bài nhóm đã dừng trong lúc chờ bài kế tiếp.' }, startedAt, attempts)
        }
      }
    }

    if (scope.cancelledRunKeys.has(job.request.runKey)) {
      return workerResult(normalizedConfig, { status: 'stopped', code: 'action_stopped', message: 'Đăng bài nhóm đã dừng theo yêu cầu.' }, startedAt, attempts)
    }
    if (success > 0) {
      return workerResult(normalizedConfig, {
        status: 'success',
        code: 'group_post_completed',
        message: `Đăng bài nhóm hoàn tất: ${success} thành công, ${skipped} bỏ qua; ${attempts}/${postsPerAccount} lượt đã chạy.`,
        data: { success, skipped, attempts, target: postsPerAccount, postingRunId }
      }, startedAt, attempts, lastOutcome ? attentionSessionState(lastOutcome) : null)
    }
    return workerResult(normalizedConfig, {
      status: 'skipped',
      code: 'group_post_no_remaining_group',
      message: 'Không còn Group chờ trong snapshot của action.',
      data: { success, skipped, attempts, target: postsPerAccount, postingRunId }
    }, startedAt, attempts, lastOutcome ? attentionSessionState(lastOutcome) : null)
  }

  stop(_accountId: number, runKey: string): void {
    const scope = this.scopes.get(scenarioRunIdFromRunKey(runKey))
    scope?.cancelledRunKeys.add(runKey)
  }

  async closeAccount(accountId: number): Promise<void> {
    await this.posting.releaseAccount(accountId).catch(() => undefined)
  }

  finishScenarioRun(runId: string): void {
    const scope = this.scopes.get(runId)
    if (!scope) return
    for (const postingRunId of scope.postingRunIds.values()) {
      const current = this.runs.get(postingRunId)
      if (!current) continue
      if (current.run.status === 'created' || current.run.status === 'running' || current.run.status === 'paused') {
        this.runs.stop(postingRunId)
      }
    }
    this.scopes.delete(runId)
  }

  closeAll(): void {
    for (const runId of [...this.scopes.keys()]) this.finishScenarioRun(runId)
    this.posting.closeAll()
  }

  private emit(
    job: ScenarioActionWorkerJob,
    onLog: ((event: ActionLogEvent) => void) | undefined,
    stage: ActionLogEvent['stage'],
    level: ActionLogEvent['level'],
    message: string,
    code?: string
  ): void {
    onLog?.({
      runKey: job.request.runKey,
      actionType: job.request.actionType,
      actor: 'profile',
      stage,
      level,
      message,
      at: Date.now(),
      ...(code ? { code } : {})
    })
  }

  private randomDelayMs(minSeconds: number, maxSeconds: number): number {
    const low = Math.max(0, Math.min(minSeconds, maxSeconds))
    const high = Math.max(low, Math.max(minSeconds, maxSeconds))
    return Math.round((high <= low ? low : low + Math.random() * (high - low)) * 1000)
  }

  private async sleep(scope: ScenarioGroupPostScope, runKey: string, delayMs: number): Promise<boolean> {
    let remaining = Math.max(0, delayMs)
    while (remaining > 0) {
      if (scope.cancelledRunKeys.has(runKey)) return false
      const chunk = Math.min(1000, remaining)
      await new Promise<void>((resolve) => setTimeout(resolve, chunk))
      remaining -= chunk
    }
    return !scope.cancelledRunKeys.has(runKey)
  }
}
