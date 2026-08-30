import type Database from 'better-sqlite3'
import {
  validateActionConfig,
  type ActionConfig,
  type ActionResult,
  type ActionResultStatus
} from '../../shared/actionRegistry'
import type { ActionLogEvent } from '../../shared/actionRuntime'
import { getK435ValidationErrors } from '../../shared/k435GroupPostActionOverrides'
import type { PostSelectionMode } from '../../shared/pageTabs'
import type { PostingJobResult } from '../../shared/posting'
import type { RunItem, RunSnapshot, RunSnapshotPost } from '../../shared/runs'
import type { ScenarioActionWorkerJob, ScenarioActionWorkerResult } from '../../shared/scenarioActionWorker'
import type { ScenarioDetails } from '../../shared/scenarios'
import {
  applyK452PostActionOverrides,
  getK452PostValidationErrors
} from '../../shared/k452PostActionOverrides'
import { ScenarioActionPostBindingRepository } from '../database/canonicalPostRepository'
import { ContentLibraryRepository } from '../database/contentLibraryRepository'
import { ScenarioRepository } from '../database/scenarioRepository'
import { ScenarioGroupPostAdapter } from './scenarioGroupPostAdapter'
import { selectRunImages, selectRunPost } from './postingSelection'
import { PostingService } from './postingService'

export interface PreparedScenarioPostAction {
  scenarioId: number
  actionId: number
  contentSetId: number
  contentSetName: string
  posts: RunSnapshotPost[]
}

export interface PreparedScenarioGroupPostAction {
  scenarioId: number
  actionId: number
  posts: RunSnapshotPost[]
}

export interface PreparedScenarioPostRun {
  actions: Map<number, PreparedScenarioPostAction>
  /** Optional for callers built before the canonical group_post cutover. */
  groupActions?: Map<number, PreparedScenarioGroupPostAction>
}

interface PreparedScenarioPostScope {
  actions: Map<number, PreparedScenarioPostAction>
  groupActions: Map<number, PreparedScenarioGroupPostAction>
}

interface ScenarioPostScope {
  prepared: PreparedScenarioPostScope
  cancelledRunKeys: Set<string>
  wallOrdinals: Map<number, number>
}

interface TargetResult {
  status: ActionResultStatus
  attempts: number
  success: number
  skipped: number
  code?: string
  message?: string
  data?: Record<string, unknown>
}

function numberConfig(config: ActionConfig, key: string, fallback: number): number {
  const value = config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringConfig(config: ActionConfig, key: string, fallback = ''): string {
  const value = config[key]
  return typeof value === 'string' ? value : fallback
}

function booleanConfig(config: ActionConfig, key: string): boolean {
  return config[key] === true
}

function scenarioRunIdFromRunKey(runKey: string): string {
  const marker = runKey.indexOf(':a')
  return marker > 0 ? runKey.slice(0, marker) : runKey
}

function parseActionConfig(details: ScenarioDetails, actionId: number, raw: string): unknown {
  try {
    return raw.trim() ? JSON.parse(raw) : {}
  } catch {
    throw new Error(`Kịch bản “${details.name}”, action #${actionId}: config JSON không hợp lệ.`)
  }
}

function clonePosts(posts: readonly RunSnapshotPost[]): RunSnapshotPost[] {
  return posts.map((post) => ({
    ...post,
    variants: [...post.variants],
    image: { ...post.image }
  }))
}

function hashRunId(value: string): number {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) || 1
}

function sessionStateFromPosting(result: PostingJobResult): ScenarioActionWorkerResult['sessionState'] {
  const state = result.sessionValidation?.state
  if (state === 'needs_login' || state === 'verification_required') return state
  return result.status === 'needs_login' ? 'needs_login' : null
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

function targetLabel(status: ActionResultStatus): string {
  if (status === 'success') return 'thành công'
  if (status === 'skipped') return 'bỏ qua'
  if (status === 'needs_attention') return 'cần xử lý'
  if (status === 'stopped') return 'đã dừng'
  return 'thất bại'
}

export class ScenarioPostActionAdapter {
  private readonly bindings: ScenarioActionPostBindingRepository
  private readonly library: ContentLibraryRepository
  private readonly scenarios: ScenarioRepository
  private readonly groupPost: ScenarioGroupPostAdapter
  private readonly scopes = new Map<string, ScenarioPostScope>()

  constructor(
    database: Database.Database,
    private readonly posting: PostingService
  ) {
    applyK452PostActionOverrides()
    this.bindings = new ScenarioActionPostBindingRepository(database)
    this.library = new ContentLibraryRepository(database)
    this.scenarios = new ScenarioRepository(database)
    this.groupPost = new ScenarioGroupPostAdapter(database, posting)
  }

  handles(actionType: string): boolean {
    return actionType === 'post' || this.groupPost.handles(actionType)
  }

  prepareScenarioRun(scenarioIds: readonly number[]): PreparedScenarioPostRun {
    const actions = new Map<number, PreparedScenarioPostAction>()
    const groupActions = new Map<number, PreparedScenarioGroupPostAction>()

    for (const scenarioId of scenarioIds) {
      const details = this.scenarios.get(scenarioId)
      if (!details) throw new Error(`Không tìm thấy kịch bản #${scenarioId}.`)

      for (const action of details.actions) {
        if (!action.enabled) continue

        if (action.actionType === 'group_post') {
          const bindingRows = this.bindings.list(action.id)
          if (!bindingRows.length) continue
          const posts = this.bindings.resolveSnapshotPosts(action.id)
          if (!posts.length) {
            throw new Error(`Kịch bản “${details.name}”, action “${action.label}”: bài viết liên kết không có bài đang bật và hợp lệ trước khi Start.`)
          }
          groupActions.set(action.id, {
            scenarioId: details.id,
            actionId: action.id,
            posts: clonePosts(posts)
          })
          continue
        }

        if (action.actionType !== 'post') continue
        const rawConfig = parseActionConfig(details, action.id, action.configJson)
        const validation = validateActionConfig('post', rawConfig)
        const extraErrors = getK452PostValidationErrors('post', validation.value)
        if (!validation.valid || extraErrors.length) {
          throw new Error(`Kịch bản “${details.name}”, action “${action.label}”: ${[...validation.errors, ...extraErrors].join(' ')}`)
        }

        const contentSetId = Math.floor(numberConfig(validation.value, 'contentSetId', 0))
        const bindingRows = this.bindings.list(action.id)
        let contentSetName: string
        let posts: RunSnapshotPost[]

        if (bindingRows.length) {
          posts = this.bindings.resolveSnapshotPosts(action.id)
          contentSetName = this.library.get(contentSetId)?.name ?? 'Bài viết đã liên kết'
          if (!posts.length) {
            throw new Error(`Kịch bản “${details.name}”, action “${action.label}”: bài viết liên kết không có bài đang bật và hợp lệ trước khi Start.`)
          }
        } else {
          const source = this.library.get(contentSetId)
          if (!source) {
            throw new Error(`Kịch bản “${details.name}”, action “${action.label}”: nguồn bài viết #${contentSetId} không tồn tại trong Thư viện chung trước khi Start.`)
          }
          contentSetName = source.name
          posts = source.items
            .filter((item) => item.enabled)
            .map((item, index): RunSnapshotPost => ({
              name: item.name,
              enabled: true,
              sortOrder: index,
              variants: item.variants.map((variant) => variant.trim()).filter(Boolean),
              image: { ...item.image, folderPath: item.image.folderPath.trim() }
            }))
            .filter((post) => post.variants.length > 0 || post.image.folderPath.length > 0)
          if (!posts.length) {
            throw new Error(`Kịch bản “${details.name}”, action “${action.label}”: nguồn “${source.name}” không có bài viết đang bật và hợp lệ.`)
          }
        }

        actions.set(action.id, {
          scenarioId: details.id,
          actionId: action.id,
          contentSetId,
          contentSetName,
          posts: clonePosts(posts)
        })
      }
    }

    return { actions, groupActions }
  }

  beginScenarioRun(runId: string, accountIds: readonly number[], prepared: PreparedScenarioPostRun): void {
    for (const staleRunId of [...this.scopes.keys()]) this.finishScenarioRun(staleRunId)
    this.scopes.set(runId, {
      prepared: {
        actions: new Map([...prepared.actions].map(([id, action]) => [id, { ...action, posts: clonePosts(action.posts) }])),
        groupActions: new Map([...(prepared.groupActions ?? new Map())].map(([id, action]) => [id, { ...action, posts: clonePosts(action.posts) }]))
      },
      cancelledRunKeys: new Set(),
      wallOrdinals: new Map()
    })
    this.groupPost.beginScenarioRun(runId, accountIds)
  }

  async run(job: ScenarioActionWorkerJob, onLog?: (event: ActionLogEvent) => void): Promise<ScenarioActionWorkerResult> {
    if (job.request.actionType === 'group_post') return this.runGroupPost(job, onLog)
    return this.runCompositePost(job, onLog)
  }

  stop(accountId: number, runKey: string): void {
    this.scopes.get(scenarioRunIdFromRunKey(runKey))?.cancelledRunKeys.add(runKey)
    this.groupPost.stop(accountId, runKey)
  }

  async closeAccount(accountId: number): Promise<void> {
    await this.groupPost.closeAccount(accountId)
  }

  finishScenarioRun(runId: string): void {
    this.groupPost.finishScenarioRun(runId)
    this.scopes.delete(runId)
  }

  closeAll(): void {
    this.groupPost.closeAll()
    this.scopes.clear()
  }

  private async runGroupPost(
    job: ScenarioActionWorkerJob,
    onLog?: (event: ActionLogEvent) => void
  ): Promise<ScenarioActionWorkerResult> {
    const actionId = job.request.scenarioActionId
    if (typeof actionId !== 'number' || !Number.isSafeInteger(actionId) || actionId <= 0) {
      return this.groupPost.run(job, onLog)
    }

    const runId = scenarioRunIdFromRunKey(job.request.runKey)
    const prepared = this.scopes.get(runId)?.prepared.groupActions.get(actionId)
    if (!prepared) return this.groupPost.run(job, onLog)

    const startedAt = Date.now()
    // Canonical bindings own content/media for this path. Keep validating the
    // legacy action's target/count/delay fields, but do not require its inline
    // content field just to execute a snapshot that was already frozen at Start.
    const validationInput = { ...job.request.config, content: '__canonical_snapshot__' }
    const validation = validateActionConfig('group_post', validationInput)
    const extraErrors = getK435ValidationErrors('group_post', validation.value)
    if (!validation.valid || extraErrors.length) {
      return workerResult(validation.value, {
        status: 'failed',
        code: 'action_config_invalid',
        message: [...validation.errors, ...extraErrors].join(' ')
      }, startedAt, 0)
    }

    const config: ActionConfig = {
      ...validation.value,
      content: typeof job.request.config.content === 'string' ? job.request.config.content : ''
    }
    const result = await this.groupPost.runWithSnapshot(job, {
      groupTargets: stringConfig(config, 'sourceTargets'),
      posts: prepared.posts,
      postMode: stringConfig(config, 'postMode', 'sequential') as PostSelectionMode,
      postsPerAccount: Math.max(1, Math.floor(numberConfig(config, 'postsPerAccount', 1))),
      postDelayMinSeconds: numberConfig(config, 'postDelayMinSeconds', 0),
      postDelayMaxSeconds: numberConfig(config, 'postDelayMaxSeconds', 0)
    }, onLog)

    return {
      ...result,
      summary: {
        ...result.summary,
        normalizedConfig: config
      }
    }
  }

  private async runCompositePost(
    job: ScenarioActionWorkerJob,
    onLog?: (event: ActionLogEvent) => void
  ): Promise<ScenarioActionWorkerResult> {
    const startedAt = Date.now()
    const validation = validateActionConfig('post', job.request.config)
    const extraErrors = getK452PostValidationErrors('post', validation.value)
    if (!validation.valid || extraErrors.length) {
      return workerResult(validation.value, {
        status: 'failed',
        code: 'action_config_invalid',
        message: [...validation.errors, ...extraErrors].join(' ')
      }, startedAt, 0)
    }
    const config = validation.value
    const actionId = job.request.scenarioActionId
    if (typeof actionId !== 'number' || !Number.isSafeInteger(actionId) || actionId <= 0) {
      return workerResult(config, {
        status: 'failed',
        code: 'post_action_id_missing',
        message: 'Action Đăng bài cần scenarioActionId để đọc snapshot của phiên.'
      }, startedAt, 0)
    }

    const runId = scenarioRunIdFromRunKey(job.request.runKey)
    const scope = this.scopes.get(runId)
    const prepared = scope?.prepared.actions.get(actionId)
    if (!scope || !prepared) {
      return workerResult(config, {
        status: 'failed',
        code: 'post_snapshot_missing',
        message: 'Không tìm thấy snapshot Thư viện chung của action trong phiên hiện tại.'
      }, startedAt, 0)
    }
    const configuredContentSetId = Math.floor(numberConfig(config, 'contentSetId', 0))
    if (configuredContentSetId !== prepared.contentSetId) {
      return workerResult(config, {
        status: 'failed',
        code: 'post_snapshot_source_mismatch',
        message: `Snapshot nguồn #${prepared.contentSetId} không khớp config nguồn #${configuredContentSetId}.`
      }, startedAt, 0)
    }

    const selectionMode = stringConfig(config, 'selectionMode', 'sequential') as PostSelectionMode
    const delayMin = numberConfig(config, 'postDelayMinSeconds', 0)
    const delayMax = numberConfig(config, 'postDelayMaxSeconds', 0)
    const postToWall = booleanConfig(config, 'postToWall')
    const postToGroups = booleanConfig(config, 'postToGroups')
    const targets: Record<string, TargetResult> = {}
    let attempts = 0
    let sessionState: ScenarioActionWorkerResult['sessionState'] = null

    this.emit(job, onLog, 'executing', 'info', `Đã khóa nguồn “${prepared.contentSetName}” (#${prepared.contentSetId}) với ${prepared.posts.length} bài cho phiên.`)

    if (postToWall) {
      const wallResult = await this.runWallTarget(job, scope, prepared, config, selectionMode, delayMin, delayMax, onLog)
      targets.wall = wallResult.target
      attempts += wallResult.target.attempts
      sessionState = wallResult.sessionState ?? sessionState
    }

    if (postToGroups && !scope.cancelledRunKeys.has(job.request.runKey)) {
      if (postToWall && (targets.wall?.attempts ?? 0) > 0) {
        const delayMs = this.randomDelayMs(delayMin, delayMax)
        if (delayMs > 0 && !await this.sleep(scope, job.request.runKey, delayMs)) {
          return workerResult(config, {
            status: 'stopped',
            code: 'action_stopped',
            message: 'Đăng bài đã dừng trong lúc chuyển từ Tường sang Nhóm.',
            data: { contentSetId: prepared.contentSetId, selectionMode, targets }
          }, startedAt, attempts, sessionState)
        }
      }
      const group = await this.groupPost.runWithSnapshot(job, {
        groupTargets: stringConfig(config, 'groupTargets'),
        posts: prepared.posts,
        postMode: selectionMode,
        postsPerAccount: Math.max(1, Math.floor(numberConfig(config, 'groupPostsPerAccount', 1))),
        postDelayMinSeconds: delayMin,
        postDelayMaxSeconds: delayMax
      }, onLog)
      const groupData = group.summary.result.data ?? {}
      targets.group = {
        status: group.summary.result.status,
        attempts: group.summary.attempts,
        success: typeof groupData.success === 'number' ? groupData.success : group.summary.result.status === 'success' ? 1 : 0,
        skipped: typeof groupData.skipped === 'number' ? groupData.skipped : group.summary.result.status === 'skipped' ? 1 : 0,
        ...(group.summary.result.code ? { code: group.summary.result.code } : {}),
        ...(group.summary.result.message ? { message: group.summary.result.message } : {}),
        ...(Object.keys(groupData).length ? { data: groupData } : {})
      }
      attempts += group.summary.attempts
      sessionState = group.sessionState ?? sessionState
    }

    if (scope.cancelledRunKeys.has(job.request.runKey)) {
      return workerResult(config, {
        status: 'stopped',
        code: 'action_stopped',
        message: 'Đăng bài đã dừng theo yêu cầu.',
        data: { contentSetId: prepared.contentSetId, selectionMode, targets }
      }, startedAt, attempts, sessionState)
    }

    const statuses = Object.values(targets).map((target) => target.status)
    const summaryText = [
      targets.wall ? `Tường: ${targetLabel(targets.wall.status)}` : null,
      targets.group ? `Nhóm: ${targetLabel(targets.group.status)}` : null
    ].filter(Boolean).join(' · ')
    let status: ActionResultStatus = 'skipped'
    let code = 'post_no_target_result'
    if (statuses.includes('needs_attention')) {
      status = 'needs_attention'
      code = 'post_partial_needs_attention'
    } else if (statuses.includes('failed')) {
      status = 'failed'
      code = 'post_partial_failure'
    } else if (statuses.includes('success')) {
      status = 'success'
      code = 'post_completed'
    } else if (statuses.includes('stopped')) {
      status = 'stopped'
      code = 'action_stopped'
    } else if (statuses.length) {
      code = 'post_all_skipped'
    }

    return workerResult(config, {
      status,
      code,
      message: `Đăng bài kết thúc. ${summaryText || 'Không có kết quả đích.'}`,
      data: {
        contentSetId: prepared.contentSetId,
        contentSetName: prepared.contentSetName,
        selectionMode,
        targets
      }
    }, startedAt, attempts, sessionState)
  }

  private async runWallTarget(
    job: ScenarioActionWorkerJob,
    scope: ScenarioPostScope,
    prepared: PreparedScenarioPostAction,
    config: ActionConfig,
    selectionMode: PostSelectionMode,
    delayMin: number,
    delayMax: number,
    onLog?: (event: ActionLogEvent) => void
  ): Promise<{ target: TargetResult; sessionState: ScenarioActionWorkerResult['sessionState'] }> {
    const pageUid = stringConfig(config, 'wallPageUid').trim()
    const targetCount = Math.max(1, Math.floor(numberConfig(config, 'wallPostsPerAccount', 1)))
    let attempts = 0
    let success = 0
    let skipped = 0
    let terminalStatus: ActionResultStatus | null = null
    let terminalCode: string | undefined
    let terminalMessage: string | undefined
    let state: ScenarioActionWorkerResult['sessionState'] = null

    for (let index = 0; index < targetCount; index += 1) {
      if (scope.cancelledRunKeys.has(job.request.runKey)) {
        terminalStatus = 'stopped'
        terminalCode = 'action_stopped'
        terminalMessage = 'Đăng tường đã dừng theo yêu cầu.'
        break
      }
      attempts += 1
      const ordinal = scope.wallOrdinals.get(prepared.actionId) ?? 0
      scope.wallOrdinals.set(prepared.actionId, ordinal + 1)
      const item = this.wallItem(job, runIdForSelection(job.request.runKey), pageUid, ordinal)
      const snapshot = this.wallSnapshot(prepared, selectionMode, pageUid)
      const material = selectRunPost(snapshot, item)
      if (!material) {
        terminalStatus = 'failed'
        terminalCode = 'no_content'
        terminalMessage = 'Snapshot Thư viện chung không còn material hợp lệ để đăng tường.'
        break
      }
      const images = await selectRunImages(material.image, item)
      if (images.missing && material.image.missingPolicy === 'skip') {
        skipped += 1
        this.emit(job, onLog, 'executing', 'info', `[Tường ${pageUid}] Bỏ qua bài #${index + 1}: thiếu ảnh theo policy.`)
      } else {
        const result = await this.posting.executePageWallPostNow({
          accountId: job.accountId,
          pageUid,
          content: material.content,
          imagePaths: images.paths
        })
        state = sessionStateFromPosting(result) ?? state
        this.emit(
          job,
          onLog,
          'executing',
          result.status === 'failed' || result.status === 'needs_login' ? 'warning' : 'info',
          `[Tường ${pageUid}] ${result.message}`,
          result.code
        )
        if (result.status === 'success') success += 1
        else if (result.status === 'skipped') skipped += 1
        else {
          terminalStatus = result.status === 'needs_login' ? 'needs_attention' : 'failed'
          terminalCode = result.code
          terminalMessage = result.message
          break
        }
      }

      if (index + 1 < targetCount && !scope.cancelledRunKeys.has(job.request.runKey)) {
        const delayMs = this.randomDelayMs(delayMin, delayMax)
        if (delayMs > 0 && !await this.sleep(scope, job.request.runKey, delayMs)) {
          terminalStatus = 'stopped'
          terminalCode = 'action_stopped'
          terminalMessage = 'Đăng tường đã dừng trong lúc chờ bài kế tiếp.'
          break
        }
      }
    }

    const status = terminalStatus ?? (success > 0 ? 'success' : 'skipped')
    const message = terminalMessage ?? `Đăng tường hoàn tất: ${success} thành công, ${skipped} bỏ qua; ${attempts}/${targetCount} lượt đã chạy.`
    return {
      target: {
        status,
        attempts,
        success,
        skipped,
        ...(terminalCode ? { code: terminalCode } : {}),
        message,
        data: { pageUid, target: targetCount }
      },
      sessionState: state
    }
  }

  private wallSnapshot(prepared: PreparedScenarioPostAction, selectionMode: PostSelectionMode, pageUid: string): RunSnapshot {
    const firstImage = prepared.posts[0]?.image ?? { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
    return {
      version: 1,
      pageTabId: 0,
      tabName: `Kịch Bản · ${prepared.contentSetName}`,
      pageUid,
      rotation: {
        postsPerAccount: 1,
        postDelayMinSeconds: 0,
        postDelayMaxSeconds: 0,
        accountDelayMinSeconds: 0,
        accountDelayMaxSeconds: 0,
        accountOrderMode: 'sequential'
      },
      accounts: [],
      schedules: [],
      contentMode: selectionMode === 'random' ? 'random' : 'sequential',
      contents: prepared.posts.flatMap((post) => post.variants),
      image: { ...firstImage },
      postMode: selectionMode,
      posts: clonePosts(prepared.posts),
      groupSourceCount: 0
    }
  }

  private wallItem(job: ScenarioActionWorkerJob, runId: number, pageUid: string, ordinal: number): RunItem {
    const now = Date.now()
    return {
      id: ordinal + 1,
      runId,
      sourceGroupItemId: null,
      groupUid: pageUid,
      sortOrder: ordinal,
      status: 'processing',
      attemptCount: 1,
      lastError: null,
      startedAt: now,
      finishedAt: null,
      updatedAt: now
    }
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
      actionType: 'post',
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

  private async sleep(scope: ScenarioPostScope, runKey: string, delayMs: number): Promise<boolean> {
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

function runIdForSelection(runKey: string): number {
  return hashRunId(scenarioRunIdFromRunKey(runKey))
}
