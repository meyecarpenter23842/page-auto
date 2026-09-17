import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { spinContent } from '../../shared/contentSpin'
import type { ContentLibraryImageConfig } from '../../shared/contentLibrary'
import type { ZaloBatchStartRequest } from '../../shared/zaloBatch'
import type {
  ZaloAccountRecord,
  ZaloActionInput,
  ZaloActionResult,
  ZaloBatchRunIdPayload,
  ZaloBatchRunSnapshot,
  ZaloBatchTargetProgress
} from '../../shared/zalo'
import { ZaloAccountRepository } from '../database/zaloRepository'
import { runRollingAccountPool } from '../services/rollingAccountPool'
import { ZaloBrowserRuntime } from './zaloBrowserRuntime'

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

type InternalTask = {
  progress: ZaloBatchTargetProgress
  messageContent: string | null
  attachmentPaths: string[]
  preparationError: string | null
}

type InternalRun = {
  runId: string
  state: ZaloBatchRunSnapshot['state']
  startedAt: number
  completedAt: number | null
  payload: ZaloBatchStartRequest
  tasks: InternalTask[]
  paused: boolean
  stopRequested: boolean
  activeAccountIds: Set<number>
  message: string
}

const ACTIVE_STATES = new Set<ZaloBatchRunSnapshot['state']>(['running', 'paused', 'stopping'])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomIndex(length: number): number {
  if (length <= 1) return 0
  return Math.floor(Math.random() * length)
}

function randomStart(length: number): number {
  return randomIndex(length)
}

function delayMs(payload: ZaloBatchStartRequest): number {
  if (payload.delayMaxMs <= payload.delayMinMs) return payload.delayMinMs
  return payload.delayMinMs + Math.floor(Math.random() * (payload.delayMaxMs - payload.delayMinMs + 1))
}

function cloneResult(result: ZaloActionResult): ZaloActionResult {
  return { ...result, ...(result.data ? { data: { ...result.data } } : {}) }
}

function cloneProgress(progress: ZaloBatchTargetProgress): ZaloBatchTargetProgress {
  return { ...progress, results: progress.results.map(cloneResult) }
}

function terminalTarget(state: ZaloBatchTargetProgress['state']): boolean {
  return state !== 'pending' && state !== 'running'
}

function targetMessage(results: readonly ZaloActionResult[]): string {
  if (!results.length) return 'Chưa có kết quả action.'
  return results.map((result) => `${result.action}: ${result.status}/${result.code}`).join(' · ')
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    if (!path || seen.has(path)) continue
    seen.add(path)
    result.push(path)
  }
  return result
}

function selectSequential(paths: readonly string[], count: number, targetIndex: number): string[] {
  if (!paths.length) return []
  const start = (targetIndex * count) % paths.length
  const result: string[] = []
  for (let offset = 0; offset < Math.min(count, paths.length); offset += 1) {
    const path = paths[(start + offset) % paths.length]
    if (path) result.push(path)
  }
  return result
}

function selectRandom(paths: readonly string[], count: number): string[] {
  if (!paths.length) return []
  const start = randomStart(paths.length)
  const result: string[] = []
  for (let offset = 0; offset < Math.min(count, paths.length); offset += 1) {
    const path = paths[(start + offset) % paths.length]
    if (path) result.push(path)
  }
  return result
}

export class ZaloBatchRunner {
  private readonly runs = new Map<string, InternalRun>()
  private readonly imageCache = new Map<string, Promise<string[]>>()
  private disposed = false

  constructor(
    private readonly accounts: ZaloAccountRepository,
    private readonly browser: ZaloBrowserRuntime
  ) {}

  async start(payload: ZaloBatchStartRequest): Promise<ZaloBatchRunSnapshot> {
    if (this.disposed) throw new Error('Zalo Batch runner đã đóng.')
    const active = [...this.runs.values()].find((run) => ACTIVE_STATES.has(run.state))
    if (active) throw new Error(`Zalo đang có batch ${active.runId} chưa kết thúc.`)

    this.imageCache.clear()
    const accountRecords = payload.accountIds.map((id) => {
      const account = this.accounts.get(id)
      if (!account) throw new Error(`Không tìm thấy Zalo account #${id}.`)
      return account
    })

    const tasks: InternalTask[] = []
    for (let index = 0; index < payload.targets.length; index += 1) {
      tasks.push(await this.snapshotTask(payload, index))
    }

    const run: InternalRun = {
      runId: randomUUID(),
      state: 'running',
      startedAt: Date.now(),
      completedAt: null,
      payload: {
        ...payload,
        accountIds: [...payload.accountIds],
        targets: [...payload.targets],
        actions: { ...payload.actions },
        contentItems: payload.contentItems.map((item) => ({
          ...item,
          variants: [...item.variants],
          image: { ...item.image }
        })),
        attachmentPaths: [...payload.attachmentPaths]
      },
      tasks,
      paused: false,
      stopRequested: false,
      activeAccountIds: new Set<number>(),
      message: `Đã snapshot ${tasks.length} target với ${accountRecords.length} tài khoản.`
    }
    this.runs.set(run.runId, run)
    this.trimRuns()

    void this.execute(run, accountRecords).catch((error) => {
      run.state = 'failed'
      run.stopRequested = true
      run.completedAt = Date.now()
      run.message = error instanceof Error ? error.message : String(error)
      this.stopActiveActions(run)
      this.markPendingStopped(run, 'Batch dừng do lỗi runner.')
    })

    return this.snapshot(run)
  }

  status(payload: ZaloBatchRunIdPayload): ZaloBatchRunSnapshot | null {
    const run = this.runs.get(payload.runId)
    return run ? this.snapshot(run) : null
  }

  pause(payload: ZaloBatchRunIdPayload): ZaloBatchRunSnapshot | null {
    const run = this.runs.get(payload.runId)
    if (!run || run.stopRequested || !ACTIVE_STATES.has(run.state)) return run ? this.snapshot(run) : null
    run.paused = true
    run.state = 'paused'
    run.message = 'Batch đã tạm dừng; action đang chạy nhận pause cooperative.'
    for (const accountId of run.activeAccountIds) this.browser.controlAction(accountId, 'pause')
    return this.snapshot(run)
  }

  resume(payload: ZaloBatchRunIdPayload): ZaloBatchRunSnapshot | null {
    const run = this.runs.get(payload.runId)
    if (!run || run.stopRequested || !ACTIVE_STATES.has(run.state)) return run ? this.snapshot(run) : null
    run.paused = false
    run.state = 'running'
    run.message = 'Batch tiếp tục chạy.'
    for (const accountId of run.activeAccountIds) this.browser.controlAction(accountId, 'resume')
    return this.snapshot(run)
  }

  stop(payload: ZaloBatchRunIdPayload): ZaloBatchRunSnapshot | null {
    const run = this.runs.get(payload.runId)
    if (!run) return null
    this.requestStop(run, 'Đang dừng batch theo yêu cầu operator.')
    return this.snapshot(run)
  }

  dispose(): void {
    this.disposed = true
    for (const run of this.runs.values()) {
      if (ACTIVE_STATES.has(run.state)) this.requestStop(run, 'Zalo runtime đang đóng.')
    }
  }

  private async snapshotTask(payload: ZaloBatchStartRequest, targetIndex: number): Promise<InternalTask> {
    const targetPhone = payload.targets[targetIndex]!
    const item = payload.contentItems.length
      ? (payload.contentMode === 'random'
          ? payload.contentItems[randomIndex(payload.contentItems.length)]
          : payload.contentItems[targetIndex % payload.contentItems.length])
      : undefined

    let messageContent: string | null = null
    if (payload.actions.sendMessage) {
      if (!item) throw new Error('Không có bài canonical snapshot cho action Gửi tin.')
      const variant = payload.contentMode === 'random'
        ? item.variants[randomIndex(item.variants.length)]
        : item.variants[targetIndex % item.variants.length]
      if (!variant) throw new Error(`Bài "${item.name}" không có biến thể hợp lệ.`)
      messageContent = spinContent(variant)
    }

    let preparationError: string | null = null
    let canonicalImages: string[] = []
    if (payload.actions.sendAttachment && item?.image.folderPath) {
      const resolved = await this.resolveCanonicalImages(item.name, item.image, targetIndex)
      canonicalImages = resolved.paths
      preparationError = resolved.error
    }

    const attachmentPaths = uniquePaths([...canonicalImages, ...payload.attachmentPaths])
    if (payload.actions.sendAttachment && attachmentPaths.length === 0 && !preparationError) {
      preparationError = 'Target không có media snapshot để chạy action Gửi ảnh/file.'
    }
    if (attachmentPaths.length > 20) {
      preparationError = `Target có ${attachmentPaths.length} file sau snapshot; Zalo chỉ nhận tối đa 20 file/action.`
    }

    return {
      progress: {
        index: targetIndex,
        targetPhone,
        assignedAccountId: null,
        state: 'pending',
        startedAt: null,
        completedAt: null,
        results: [],
        message: preparationError ?? 'Đang chờ.'
      },
      messageContent,
      attachmentPaths,
      preparationError
    }
  }

  private async resolveCanonicalImages(
    itemName: string,
    image: ContentLibraryImageConfig,
    targetIndex: number
  ): Promise<{ paths: string[]; error: string | null }> {
    if (image.mode === 'filename_match') {
      return {
        paths: [],
        error: `Bài "${itemName}" dùng ảnh “Khớp Group UID”; mode này không có identity phù hợp cho target SĐT Zalo.`
      }
    }

    let available: string[]
    try {
      let pending = this.imageCache.get(image.folderPath)
      if (!pending) {
        pending = readdir(image.folderPath, { withFileTypes: true }).then((entries) => (
          entries
            .filter((entry) => entry.isFile() && SUPPORTED_IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
            .map((entry) => join(image.folderPath, entry.name))
            .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))
        ))
        this.imageCache.set(image.folderPath, pending)
      }
      available = await pending
    } catch {
      if (image.missingPolicy === 'text_only') return { paths: [], error: null }
      return { paths: [], error: `Không đọc được folder ảnh của bài "${itemName}".` }
    }

    const paths = image.mode === 'random'
      ? selectRandom(available, image.imagesPerPost)
      : selectSequential(available, image.imagesPerPost, targetIndex)

    if (paths.length < image.imagesPerPost && image.missingPolicy === 'skip') {
      return {
        paths: [],
        error: `Bài "${itemName}" cần ${image.imagesPerPost} ảnh nhưng chỉ snapshot được ${paths.length}.`
      }
    }
    return { paths, error: null }
  }

  private async execute(run: InternalRun, accountRecords: ZaloAccountRecord[]): Promise<void> {
    const accountById = new Map(accountRecords.map((account) => [account.id, account]))
    const activeLeases = new Set<number>()
    const nextEligibleAt = new Map<number, number>()
    const items = run.tasks.map((task) => {
      const accountId = run.payload.accountIds[task.progress.index % run.payload.accountIds.length]
      const account = accountId === undefined ? undefined : accountById.get(accountId)
      if (!account) throw new Error(`Không tìm thấy account được gán cho target ${task.progress.targetPhone}.`)
      task.progress.assignedAccountId = account.id
      return { task, account }
    })

    await runRollingAccountPool({
      items,
      concurrency: run.payload.concurrency,
      tryAcquire: (item) => {
        const accountId = item.account.id
        if (activeLeases.has(accountId)) return null
        if ((nextEligibleAt.get(accountId) ?? 0) > Date.now()) return null
        activeLeases.add(accountId)
        return {
          release: () => {
            activeLeases.delete(accountId)
            nextEligibleAt.set(accountId, Date.now() + delayMs(run.payload))
          }
        }
      },
      waitUntilRunnable: () => this.waitUntilRunnable(run),
      shouldStop: () => run.stopRequested || this.disposed,
      run: async (item) => {
        const { task, account } = item
        task.progress.state = 'running'
        task.progress.startedAt = Date.now()
        task.progress.message = 'Đang chạy.'
        run.activeAccountIds.add(account.id)
        try {
          await this.executeTarget(run, account, task)
        } catch (error) {
          task.progress.state = 'failed'
          task.progress.message = error instanceof Error ? error.message : String(error)
        } finally {
          task.progress.completedAt = Date.now()
          run.activeAccountIds.delete(account.id)
        }

        if (
          run.payload.failurePolicy === 'stop_run'
          && (task.progress.state === 'failed' || task.progress.state === 'partial')
        ) {
          this.requestStop(run, `Dừng batch vì target ${task.progress.targetPhone} không thành công hoàn toàn.`)
        }
      }
    })

    if (run.stopRequested || this.disposed) {
      this.markPendingStopped(run, 'Chưa chạy vì batch đã dừng.')
      if (run.state !== 'failed') run.state = 'stopped'
      run.completedAt = Date.now()
      run.message = run.state === 'failed' ? run.message : 'Batch đã dừng.'
      return
    }

    run.state = 'completed'
    run.completedAt = Date.now()
    const snapshot = this.snapshot(run)
    run.message = `Hoàn tất ${snapshot.completedTargets}/${snapshot.totalTargets} target; thành công ${snapshot.successTargets}, lỗi/partial ${snapshot.failedTargets}.`
  }

  private async executeTarget(run: InternalRun, account: ZaloAccountRecord, task: InternalTask): Promise<void> {
    if (task.preparationError) {
      task.progress.state = 'failed'
      task.progress.message = task.preparationError
      return
    }

    const actions: ZaloActionInput[] = []
    if (run.payload.actions.sendMessage && task.messageContent) {
      actions.push({ type: 'send_message', targetPhone: task.progress.targetPhone, content: task.messageContent })
    }
    if (run.payload.actions.sendAttachment) {
      actions.push({ type: 'send_attachment', targetPhone: task.progress.targetPhone, paths: [...task.attachmentPaths] })
    }
    if (run.payload.actions.addFriend) {
      actions.push({ type: 'add_friend', targetPhone: task.progress.targetPhone, message: run.payload.friendMessage })
    }

    for (const action of actions) {
      if (run.stopRequested || this.disposed) break
      if (!await this.waitUntilRunnable(run)) break
      const result = await this.browser.executeAction(account, action)
      task.progress.results.push(result)
      if (result.status === 'stopped') {
        task.progress.state = 'stopped'
        task.progress.message = result.message
        return
      }
      if (run.payload.failurePolicy === 'stop_run' && result.status !== 'success') break
    }

    if (run.stopRequested || this.disposed) {
      task.progress.state = 'stopped'
      task.progress.message = task.progress.results.length
        ? targetMessage(task.progress.results)
        : 'Target dừng trước khi action hoàn tất.'
      return
    }

    const successCount = task.progress.results.filter((result) => result.status === 'success').length
    if (successCount === task.progress.results.length && successCount > 0) task.progress.state = 'success'
    else if (successCount > 0) task.progress.state = 'partial'
    else task.progress.state = 'failed'
    task.progress.message = targetMessage(task.progress.results)
  }

  private async waitUntilRunnable(run: InternalRun): Promise<boolean> {
    while (run.paused && !run.stopRequested && !this.disposed) await sleep(100)
    return !run.stopRequested && !this.disposed
  }

  private requestStop(run: InternalRun, message: string): void {
    if (run.completedAt !== null) return
    run.stopRequested = true
    run.paused = false
    if (run.state !== 'failed') run.state = 'stopping'
    run.message = message
    this.stopActiveActions(run)
  }

  private stopActiveActions(run: InternalRun): void {
    for (const accountId of run.activeAccountIds) this.browser.controlAction(accountId, 'stop')
  }

  private markPendingStopped(run: InternalRun, message: string): void {
    for (const task of run.tasks) {
      if (task.progress.state !== 'pending') continue
      task.progress.state = 'stopped'
      task.progress.completedAt = Date.now()
      task.progress.message = message
    }
  }

  private snapshot(run: InternalRun): ZaloBatchRunSnapshot {
    const progress = run.tasks.map((task) => cloneProgress(task.progress))
    const completedTargets = progress.filter((item) => terminalTarget(item.state)).length
    const successTargets = progress.filter((item) => item.state === 'success').length
    const failedTargets = progress.filter((item) => item.state === 'failed' || item.state === 'partial').length
    return {
      runId: run.runId,
      state: run.state,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      accountIds: [...run.payload.accountIds],
      totalTargets: progress.length,
      completedTargets,
      successTargets,
      failedTargets,
      progress,
      message: run.message
    }
  }

  private trimRuns(): void {
    const runs = [...this.runs.values()].sort((left, right) => right.startedAt - left.startedAt)
    for (const stale of runs.slice(10)) {
      if (!ACTIVE_STATES.has(stale.state)) this.runs.delete(stale.runId)
    }
  }
}
