import { randomUUID } from 'node:crypto'
import { spinContent } from '../../shared/contentSpin'
import {
  normalizeZaloBatchStartPayload,
  type ZaloAccountRecord,
  type ZaloActionInput,
  type ZaloActionResult,
  type ZaloActionType,
  type ZaloBatchContentItemSnapshot,
  type ZaloBatchRunSnapshot,
  type ZaloBatchStartPayload,
  type ZaloBatchTargetProgress
} from '../../shared/zalo'
import { runRollingAccountPool } from '../services/rollingAccountPool'
import { ZaloAccountRepository } from '../database/zaloRepository'
import { ZaloBrowserRuntime } from './zaloBrowserRuntime'
import { selectZaloMedia } from './zaloMediaSelection'

type MutableRun = {
  snapshot: ZaloBatchRunSnapshot
  payload: ZaloBatchStartPayload
  paused: boolean
  stopRequested: boolean
  runningAccountIds: Set<number>
}

type SelectedPost = {
  item: ZaloBatchContentItemSnapshot
  postIndex: number
  variantIndex: number | null
  content: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cloneProgress(item: ZaloBatchTargetProgress): ZaloBatchTargetProgress {
  return {
    ...item,
    results: item.results.map((result) => ({ ...result })),
    mediaPaths: [...item.mediaPaths]
  }
}

function cloneSnapshot(snapshot: ZaloBatchRunSnapshot): ZaloBatchRunSnapshot {
  return {
    ...snapshot,
    accountIds: [...snapshot.accountIds],
    actions: [...snapshot.actions],
    progress: snapshot.progress.map(cloneProgress)
  }
}

function randomDelay(min: number, max: number): number {
  if (max <= min) return min
  return min + Math.floor(Math.random() * (max - min + 1))
}

function actionTypes(payload: ZaloBatchStartPayload): ZaloActionType[] {
  return [
    payload.actions.sendMessage ? 'send_message' : null,
    payload.actions.sendAttachment ? 'send_attachment' : null,
    payload.actions.addFriend ? 'add_friend' : null
  ].filter((value): value is ZaloActionType => value !== null)
}

function selectPost(payload: ZaloBatchStartPayload, targetIndex: number): SelectedPost | null {
  if (!payload.contentItems.length) return null
  const postIndex = payload.contentMode === 'random'
    ? Math.floor(Math.random() * payload.contentItems.length)
    : targetIndex % payload.contentItems.length
  const item = payload.contentItems[postIndex]
  if (!item) return null

  if (!item.variants.length) return { item, postIndex, variantIndex: null, content: '' }
  const variantIndex = payload.contentMode === 'random'
    ? Math.floor(Math.random() * item.variants.length)
    : Math.floor(targetIndex / payload.contentItems.length) % item.variants.length
  const variant = item.variants[variantIndex] ?? item.variants[0] ?? ''
  return { item, postIndex, variantIndex, content: variant ? spinContent(variant) : '' }
}

export class ZaloBatchRunner {
  private readonly runs = new Map<string, MutableRun>()

  constructor(
    private readonly accounts: ZaloAccountRepository,
    private readonly browser: ZaloBrowserRuntime
  ) {}

  start(input: ZaloBatchStartPayload): ZaloBatchRunSnapshot {
    const normalized = normalizeZaloBatchStartPayload(input)
    const selectedAccounts = normalized.accountIds.map((id) => {
      const account = this.accounts.get(id)
      if (!account) throw new Error('Không tìm thấy Zalo account #' + id + '.')
      return account
    }).filter((account) => account.sessionStatus === 'ready')
    if (!selectedAccounts.length) throw new Error('Không có tài khoản Zalo Sẵn sàng để chạy.')

    const readyIds = new Set(selectedAccounts.map((account) => account.id))
    const payload: ZaloBatchStartPayload = {
      ...normalized,
      accountIds: normalized.accountIds.filter((id) => readyIds.has(id)),
      contentItems: normalized.contentItems.map((item) => ({
        ...item,
        variants: [...item.variants],
        media: { ...item.media }
      })),
      concurrency: Math.min(normalized.concurrency, selectedAccounts.length)
    }

    const runId = randomUUID()
    const progress = payload.targets.map<ZaloBatchTargetProgress>((targetPhone, index) => ({
      index,
      targetPhone,
      assignedAccountId: null,
      state: 'pending',
      startedAt: null,
      completedAt: null,
      results: [],
      message: 'Đang chờ',
      postId: null,
      postName: null,
      variantIndex: null,
      contentPreview: '',
      mediaPaths: [],
      currentAction: null
    }))
    const run: MutableRun = {
      payload,
      paused: false,
      stopRequested: false,
      runningAccountIds: new Set(),
      snapshot: {
        runId,
        state: 'running',
        startedAt: Date.now(),
        completedAt: null,
        accountIds: [...payload.accountIds],
        actions: actionTypes(payload),
        totalTargets: progress.length,
        completedTargets: 0,
        successTargets: 0,
        failedTargets: 0,
        progress,
        message: 'Batch Zalo đang chạy.'
      }
    }
    this.runs.set(runId, run)
    void this.execute(run, selectedAccounts).catch((error) => {
      run.snapshot.state = 'failed'
      run.snapshot.completedAt = Date.now()
      run.snapshot.message = error instanceof Error ? error.message : String(error)
    })
    return cloneSnapshot(run.snapshot)
  }

  status(runId: string): ZaloBatchRunSnapshot | null {
    const run = this.runs.get(runId)
    return run ? cloneSnapshot(run.snapshot) : null
  }

  pause(runId: string): ZaloBatchRunSnapshot | null {
    const run = this.runs.get(runId)
    if (!run || !['running', 'paused'].includes(run.snapshot.state)) return run ? cloneSnapshot(run.snapshot) : null
    run.paused = true
    run.snapshot.state = 'paused'
    run.snapshot.message = 'Batch Zalo đã tạm dừng.'
    for (const id of run.runningAccountIds) this.browser.controlAction(id, 'pause')
    return cloneSnapshot(run.snapshot)
  }

  resume(runId: string): ZaloBatchRunSnapshot | null {
    const run = this.runs.get(runId)
    if (!run || !['running', 'paused'].includes(run.snapshot.state)) return run ? cloneSnapshot(run.snapshot) : null
    run.paused = false
    run.snapshot.state = 'running'
    run.snapshot.message = 'Batch Zalo tiếp tục chạy.'
    for (const id of run.runningAccountIds) this.browser.controlAction(id, 'resume')
    return cloneSnapshot(run.snapshot)
  }

  stop(runId: string): ZaloBatchRunSnapshot | null {
    const run = this.runs.get(runId)
    if (!run || ['completed', 'stopped', 'failed'].includes(run.snapshot.state)) return run ? cloneSnapshot(run.snapshot) : null
    run.stopRequested = true
    run.paused = false
    run.snapshot.state = 'stopping'
    run.snapshot.message = 'Đang dừng batch Zalo…'
    for (const id of run.runningAccountIds) this.browser.controlAction(id, 'stop')
    return cloneSnapshot(run.snapshot)
  }

  dispose(): void {
    for (const run of this.runs.values()) {
      run.stopRequested = true
      for (const id of run.runningAccountIds) this.browser.controlAction(id, 'stop')
    }
  }

  private async waitUntilRunnable(run: MutableRun): Promise<boolean> {
    while (run.paused && !run.stopRequested) await sleep(100)
    return !run.stopRequested
  }

  private async execute(run: MutableRun, selectedAccounts: ZaloAccountRecord[]): Promise<void> {
    let nextTargetIndex = 0

    await runRollingAccountPool({
      items: selectedAccounts,
      concurrency: run.payload.concurrency,
      tryAcquire: () => ({ release: () => undefined }),
      shouldStop: () => run.stopRequested,
      waitUntilRunnable: () => this.waitUntilRunnable(run),
      run: async (account) => {
        run.runningAccountIds.add(account.id)
        try {
          while (!run.stopRequested) {
            if (!await this.waitUntilRunnable(run)) break
            const index = nextTargetIndex
            nextTargetIndex += 1
            const target = run.snapshot.progress[index]
            if (!target) break
            await this.executeTarget(run, account, target)
            if (run.payload.failurePolicy === 'stop_run' && ['failed', 'partial'].includes(target.state)) {
              run.stopRequested = true
              break
            }
            if (!run.stopRequested && nextTargetIndex < run.snapshot.progress.length) {
              await sleep(randomDelay(run.payload.delayMinMs, run.payload.delayMaxMs))
            }
          }
        } finally {
          run.runningAccountIds.delete(account.id)
        }
      }
    })

    if (run.stopRequested) {
      for (const target of run.snapshot.progress) {
        if (target.state === 'pending') {
          target.state = 'stopped'
          target.completedAt = Date.now()
          target.message = 'Chưa chạy do batch đã dừng.'
        }
      }
      run.snapshot.state = 'stopped'
      run.snapshot.message = 'Batch Zalo đã dừng.'
    } else {
      run.snapshot.state = 'completed'
      run.snapshot.message = 'Hoàn tất ' + run.snapshot.completedTargets + '/' + run.snapshot.totalTargets + ' target.'
    }
    run.snapshot.completedAt = Date.now()
  }

  private async executeTarget(run: MutableRun, account: ZaloAccountRecord, target: ZaloBatchTargetProgress): Promise<void> {
    target.assignedAccountId = account.id
    target.state = 'running'
    target.startedAt = Date.now()
    target.message = 'Đang chuẩn bị'

    const selected = selectPost(run.payload, target.index)
    if (selected) {
      target.postId = selected.item.sourceItemId
      target.postName = selected.item.name
      target.variantIndex = selected.variantIndex
      target.contentPreview = selected.content
      const media = await selectZaloMedia(selected.item.media, {
        runId: run.snapshot.runId,
        targetPhone: target.targetPhone,
        targetIndex: target.index,
        postIndex: selected.postIndex
      })
      target.mediaPaths = [...media.paths]
      if (run.payload.actions.sendAttachment && media.missing && selected.item.media.missingPolicy === 'skip') {
        this.finishWithoutAction(run, target, 'Thiếu media theo policy của Bài Zalo.')
        return
      }
    }

    if (run.payload.actions.sendMessage && !selected?.content) {
      this.finishWithoutAction(run, target, 'Bài Zalo được chọn không có nội dung để gửi.')
      return
    }

    const actions: ZaloActionInput[] = []
    if (run.payload.actions.sendMessage && selected?.content) {
      actions.push({ type: 'send_message', targetPhone: target.targetPhone, content: selected.content })
    }
    if (run.payload.actions.sendAttachment && target.mediaPaths.length) {
      actions.push({ type: 'send_attachment', targetPhone: target.targetPhone, paths: [...target.mediaPaths] })
    }
    if (run.payload.actions.addFriend) {
      actions.push({ type: 'add_friend', targetPhone: target.targetPhone, message: run.payload.friendMessage })
    }

    const results: ZaloActionResult[] = []
    for (const action of actions) {
      if (!await this.waitUntilRunnable(run)) break
      target.currentAction = action.type
      target.message = 'Đang chạy ' + action.type
      const result = await this.browser.executeAction(account, action)
      results.push(result)
      if (result.status === 'stopped') {
        run.stopRequested = true
        break
      }
      if (result.status !== 'success' && run.payload.failurePolicy === 'stop_run') break
    }
    target.currentAction = null

    target.results = results
    target.completedAt = Date.now()
    const successCount = results.filter((result) => result.status === 'success').length
    if (run.stopRequested && successCount === 0) {
      target.state = 'stopped'
      target.message = 'Đã dừng'
    } else if (results.length === actions.length && successCount === actions.length) {
      target.state = 'success'
      target.message = 'Thành công'
      run.snapshot.successTargets += 1
    } else if (successCount > 0) {
      target.state = 'partial'
      target.message = 'Thành công một phần'
      run.snapshot.failedTargets += 1
    } else {
      target.state = 'failed'
      target.message = results[results.length - 1]?.message ?? 'Không hoàn tất action.'
      run.snapshot.failedTargets += 1
    }
    run.snapshot.completedTargets += 1
  }

  private finishWithoutAction(run: MutableRun, target: ZaloBatchTargetProgress, message: string): void {
    target.currentAction = null
    target.completedAt = Date.now()
    target.state = 'failed'
    target.message = message
    run.snapshot.completedTargets += 1
    run.snapshot.failedTargets += 1
  }
}
