import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import type { PageWallRunNowPayload } from '../shared/pageWall'
import {
  PAGE_WALL_FINITE_IPC,
  normalizePageWallScheduleMinutes,
  type PageWallFiniteApi,
  type PageWallFiniteDashboard,
  type PageWallFinitePagePayload,
  type PageWallFinitePlanIdPayload,
  type PageWallFinitePlanIdsPayload,
  type PageWallFiniteRunNowPayload,
  type PageWallFiniteRunNowResult,
  type SavePageWallFinitePlanPayload,
  type SavePageWallFiniteSchedulePayload
} from '../shared/pageWallFiniteRuntime'
import type { PageWallPlanRecord, PageWallPlanTaskDefinition, SavePageWallPlanInput } from '../shared/pageWallPlans'
import { AppSettingsRepository } from './database/appSettingsRepository'
import { BrowserWindowLayoutRepository } from './database/browserWindowLayoutRepository'
import { CanonicalPostRepository } from './database/canonicalPostRepository'
import { PageTabRepository } from './database/pageTabRepository'
import { PageWallJobRepository, type CreatePageWallJobInput } from './database/pageWallJobRepository'
import { PageWallPlanRepository, type PageWallPlanOccurrenceWithJobs } from './database/pageWallPlanRepository'
import { BrowserWindowLayoutManager } from './browser/browserWindowLayoutManager'
import { AccountExecutionCoordinator } from './services/accountExecutionCoordinator'
import { PageWallRunNowService } from './services/pageWallRunNowService'
import { PostingService } from './services/postingService'
import { runRollingAccountPool } from './services/rollingAccountPool'

const DAY_MS = 24 * 60 * 60 * 1000
const PARK_MS = 370 * DAY_MS

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function scheduledAtFor(localDate: string, minuteOfDay: number): number {
  const [year, month, day] = localDate.split('-').map(Number)
  const hour = Math.floor(minuteOfDay / 60)
  const minute = minuteOfDay % 60
  return new Date(year!, month! - 1, day!, hour, minute, 0, 0).getTime()
}

function positiveUniqueIds(values: number[]): number[] {
  const seen = new Set<number>()
  return values.filter((value) => Number.isSafeInteger(value) && value > 0 && !seen.has(value) && Boolean(seen.add(value)))
}

function limitConcurrency(value: number, max: number): number {
  return Math.max(1, Math.min(max, Math.floor(value || 1)))
}

function singleSlotInput(payload: SavePageWallFiniteSchedulePayload, minuteOfDay: number): SavePageWallPlanInput {
  return {
    pageTabId: payload.input.pageTabId,
    scheduleKind: payload.input.scheduleKind,
    localDate: payload.input.scheduleKind === 'specific_date' ? payload.input.localDate : null,
    minuteOfDay,
    accountConcurrency: payload.input.accountConcurrency,
    tasks: payload.input.tasks,
    enabled: payload.input.enabled
  }
}

export interface PageWallFiniteRuntime {
  dispose(): void
}

export function registerPageWallFiniteRuntime(database: Database.Database, dataDirectory: string): PageWallFiniteRuntime {
  const pageTabs = new PageTabRepository(database)
  const plans = new PageWallPlanRepository(database)
  const jobs = new PageWallJobRepository(database)
  const posts = new CanonicalPostRepository(database)
  const appSettings = new AppSettingsRepository(database)
  const layoutSettings = new BrowserWindowLayoutRepository(database)
  const windowLayout = new BrowserWindowLayoutManager()
  const accountExecution = new AccountExecutionCoordinator()
  const posting = new PostingService(
    database,
    dataDirectory,
    () => appSettings.get().browser,
    () => appSettings.get().session,
    () => appSettings.get().network,
    () => appSettings.get().runtime,
    () => appSettings.get().logging,
    async () => undefined,
    windowLayout,
    () => layoutSettings.get()
  )
  const rawExecutor = { executePageWallPostNow: (input: Parameters<PostingService['executePageWallPostNow']>[0]) => posting.executePageWallPostNow(input) }
  const runNow = new PageWallRunNowService(pageTabs, rawExecutor)
  const activeOccurrences = new Set<number>()
  let disposed = false
  let ticking = false

  const sourcePayload = (pageTabId: number, accountId: number, source: PageWallPlanTaskDefinition['source']): PageWallRunNowPayload => {
    if (source.kind === 'manual') {
      return { pageTabId, accountId, content: source.content, imagePaths: [...source.imagePaths] }
    }
    const post = posts.get(source.postId)
    if (!post) throw new Error(`Không tìm thấy bài canonical #${source.postId}.`)
    const content = post.variants[source.variantIndex] ?? (post.variants.length === 0 && source.variantIndex === 0 ? '' : undefined)
    if (content === undefined) throw new Error(`Bài canonical #${source.postId} không còn biến thể ${source.variantIndex + 1}.`)
    return {
      pageTabId,
      accountId,
      content,
      imagePaths: [],
      canonicalPost: {
        postId: post.id,
        postName: post.name,
        variantIndex: source.variantIndex,
        content,
        image: { ...post.image }
      }
    }
  }

  const concreteJobsForPlan = async (plan: PageWallPlanRecord, scheduledAt: number): Promise<CreatePageWallJobInput[]> => {
    const concrete: CreatePageWallJobInput[] = []
    for (const task of plan.tasks) {
      const preparation = await runNow.prepare(sourcePayload(plan.pageTabId, task.accountId, task.source))
      if (!preparation.ok) throw new Error(preparation.result.message)
      const prepared = preparation.prepared
      concrete.push({
        scheduledAt,
        pageTabId: plan.pageTabId,
        pageTabName: prepared.pageTabName,
        pageUid: prepared.input.pageUid,
        accountId: prepared.input.accountId,
        accountUid: prepared.accountUid,
        accountName: prepared.accountName,
        content: prepared.input.content,
        imagePaths: [...prepared.input.imagePaths]
      })
    }
    return concrete
  }

  const markOccurrence = (id: number, status: string, message: string | null, now: number, finished: boolean) => {
    database.prepare(`
      UPDATE page_wall_plan_occurrences
      SET status = ?, result_message = ?,
          started_at = COALESCE(started_at, ?),
          finished_at = CASE WHEN ? THEN ? ELSE finished_at END,
          updated_at = ?
      WHERE id = ?
    `).run(status, message, now, finished ? 1 : 0, now, now, id)
  }

  const claimOccurrenceJob = (jobId: number, scheduledAt: number, now: number): boolean => {
    const updated = database.prepare(`
      UPDATE page_wall_jobs
      SET status = 'running', scheduled_at = ?, started_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(scheduledAt, now, now, jobId)
    return updated.changes === 1
  }

  const launchOccurrence = (bundle: PageWallPlanOccurrenceWithJobs): void => {
    if (disposed || activeOccurrences.has(bundle.occurrence.id)) return
    activeOccurrences.add(bundle.occurrence.id)
    const occurrence = bundle.occurrence
    markOccurrence(occurrence.id, 'running', null, Date.now(), false)

    void runRollingAccountPool({
      items: bundle.jobs,
      concurrency: occurrence.accountConcurrency,
      tryAcquire: (item) => accountExecution.tryAcquireLease(item.job.accountId),
      waitUntilRunnable: async () => !disposed,
      shouldStop: () => disposed,
      run: async (item) => {
        const startedAt = Date.now()
        if (!claimOccurrenceJob(item.job.id, occurrence.scheduledAt, startedAt)) return
        const current = jobs.get(item.job.id)
        if (!current) return
        try {
          const result = await posting.executePageWallPostNow({
            accountId: current.accountId,
            pageUid: current.pageUid,
            content: current.content,
            imagePaths: [...current.imagePaths]
          })
          jobs.finish(current.id, result, Date.now())
        } catch (error) {
          jobs.finish(current.id, {
            status: 'failed',
            code: 'unexpected_error',
            message: error instanceof Error ? error.message : String(error)
          }, Date.now())
        }
      }
    }).then(() => {
      const refreshed = plans.listOccurrenceJobs(occurrence.id).map((item) => item.job)
      const needsAttention = refreshed.some((job) => job.resultStatus === 'needs_login')
      const failed = refreshed.some((job) => job.status !== 'success')
      const status = needsAttention ? 'needs_attention' : failed ? 'failed' : 'success'
      const successCount = refreshed.filter((job) => job.status === 'success').length
      markOccurrence(occurrence.id, status, `${successCount}/${refreshed.length} task thành công.`, Date.now(), true)
      const plan = plans.get(occurrence.planId)
      if (plan?.scheduleKind === 'specific_date') {
        plans.setStatus(plan.id, needsAttention ? 'needs_attention' : 'completed', needsAttention ? 'Có tài khoản cần đăng nhập/xác minh.' : null)
      } else if (needsAttention && plan) {
        plans.setStatus(plan.id, 'needs_attention', 'Có tài khoản cần đăng nhập/xác minh.')
      }
    }).catch((error) => {
      markOccurrence(occurrence.id, 'failed', error instanceof Error ? error.message : String(error), Date.now(), true)
    }).finally(() => activeOccurrences.delete(occurrence.id))
  }

  const materializePlan = async (plan: PageWallPlanRecord, localDate: string, now: number) => {
    if (plans.occurrenceExists(plan.id, localDate)) return
    const scheduledAt = scheduledAtFor(localDate, plan.minuteOfDay)
    const concrete = await concreteJobsForPlan(plan, scheduledAt)
    const bundle = plans.createOccurrenceWithJobs({ planId: plan.id, localDate, scheduledAt, jobs: concrete }, now)
    if (!bundle) return

    // Finite-plan jobs belong to the occurrence runner, not the legacy Wall scheduler.
    // Park them synchronously before yielding; the occurrence runner restores the real
    // scheduled_at in the same atomic claim that moves each job to running.
    const parkAt = scheduledAt + PARK_MS
    const park = database.prepare("UPDATE page_wall_jobs SET scheduled_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
    for (const item of bundle.jobs) park.run(parkAt, now, item.job.id)
    launchOccurrence({ occurrence: bundle.occurrence, jobs: plans.listOccurrenceJobs(bundle.occurrence.id) })
  }

  const tick = async () => {
    if (disposed || ticking) return
    ticking = true
    const now = Date.now()
    const localDate = localDateKey(new Date(now))
    try {
      const rows = database.prepare("SELECT id FROM page_wall_plans WHERE status = 'active' ORDER BY id").all() as Array<{ id: number }>
      for (const row of rows) {
        const plan = plans.get(row.id)
        if (!plan) continue
        if (plan.scheduleKind === 'specific_date' && plan.localDate !== localDate) continue
        const scheduledAt = scheduledAtFor(localDate, plan.minuteOfDay)
        if (scheduledAt > now) continue
        try {
          await materializePlan(plan, localDate, now)
        } catch (error) {
          plans.setStatus(plan.id, 'needs_attention', error instanceof Error ? error.message : String(error), now)
        }
      }
    } finally { ticking = false }
  }

  const getDashboard = (payload: PageWallFinitePagePayload): PageWallFiniteDashboard => {
    const pageTabId = payload.pageTabId
    const pagePlans = plans.listByPage(pageTabId)
    return {
      plans: pagePlans.map((plan) => ({ ...plan, latestOccurrence: plans.listOccurrences(plan.id, 1)[0] ?? null })),
      jobs: jobs.list(500).filter((job) => job.pageTabId === pageTabId)
    }
  }

  const runBatch = async (payload: PageWallFiniteRunNowPayload): Promise<PageWallFiniteRunNowResult> => {
    const accountIds = positiveUniqueIds(payload.accountIds)
    if (accountIds.length === 0) throw new Error('Hãy tick ít nhất một tài khoản để Đăng ngay.')
    const concurrency = limitConcurrency(payload.accountConcurrency, 20)
    const results: PageWallFiniteRunNowResult['results'] = []
    await runRollingAccountPool({
      items: accountIds.map((accountId, order) => ({ accountId, order })),
      concurrency,
      tryAcquire: (item) => accountExecution.tryAcquireLease(item.accountId),
      waitUntilRunnable: async () => !disposed,
      shouldStop: () => disposed,
      run: async (item) => {
        const result = await runNow.execute({
          pageTabId: payload.pageTabId,
          accountId: item.accountId,
          content: payload.content,
          imagePaths: [...payload.imagePaths],
          ...(payload.canonicalPost ? { canonicalPost: { ...payload.canonicalPost, image: { ...payload.canonicalPost.image } } } : {})
        })
        results.push(result)
      }
    })
    const order = new Map(accountIds.map((id, index) => [id, index]))
    results.sort((left, right) => (order.get(left.accountId) ?? 0) - (order.get(right.accountId) ?? 0))
    return { accountConcurrency: concurrency, requestedAccountIds: accountIds, results }
  }

  const saveSchedule = (payload: SavePageWallFiniteSchedulePayload): PageWallPlanRecord[] => {
    const minuteOfDays = normalizePageWallScheduleMinutes(payload.input.minuteOfDays)
    const planIds = positiveUniqueIds(payload.planIds ?? [])
    return database.transaction(() => {
      for (const planId of planIds) {
        const existing = plans.get(planId)
        if (!existing) throw new Error(`Không tìm thấy slot lịch Đăng Tường #${planId}.`)
        if (existing.pageTabId !== payload.input.pageTabId) throw new Error('Slot lịch không thuộc đúng Page đang sửa.')
        if (plans.listOccurrences(planId, 1).length > 0) throw new Error('Lịch đã phát sinh lượt chạy; hãy tạo lịch mới thay vì sửa lịch sử.')
      }

      const saved: PageWallPlanRecord[] = []
      for (let index = 0; index < minuteOfDays.length; index += 1) {
        const input = singleSlotInput(payload, minuteOfDays[index]!)
        const existingId = planIds[index]
        saved.push(existingId ? plans.update(existingId, input) : plans.create(input))
      }
      for (const staleId of planIds.slice(minuteOfDays.length)) plans.delete(staleId)
      return saved
    })()
  }

  const deleteSchedule = (payload: PageWallFinitePlanIdsPayload): number => {
    const planIds = positiveUniqueIds(payload.planIds)
    return database.transaction(() => planIds.reduce((count, id) => count + (plans.delete(id) ? 1 : 0), 0))()
  }

  const api: PageWallFiniteApi = {
    getDashboard: async (payload) => getDashboard(payload),
    runNow: runBatch,
    savePlan: async (payload: SavePageWallFinitePlanPayload) => {
      const record = payload.planId ? plans.update(payload.planId, payload.input) : plans.create(payload.input)
      void tick()
      return record
    },
    deletePlan: async (payload: PageWallFinitePlanIdPayload) => plans.delete(payload.planId),
    saveSchedule: async (payload) => {
      const records = saveSchedule(payload)
      void tick()
      return records
    },
    deleteSchedule: async (payload) => deleteSchedule(payload)
  }

  ipcMain.handle(PAGE_WALL_FINITE_IPC.dashboard, (_event, payload: PageWallFinitePagePayload) => api.getDashboard(payload))
  ipcMain.handle(PAGE_WALL_FINITE_IPC.runNow, (_event, payload: PageWallFiniteRunNowPayload) => api.runNow(payload))
  ipcMain.handle(PAGE_WALL_FINITE_IPC.savePlan, (_event, payload: SavePageWallFinitePlanPayload) => api.savePlan(payload))
  ipcMain.handle(PAGE_WALL_FINITE_IPC.deletePlan, (_event, payload: PageWallFinitePlanIdPayload) => api.deletePlan(payload))
  ipcMain.handle(PAGE_WALL_FINITE_IPC.saveSchedule, (_event, payload: SavePageWallFiniteSchedulePayload) => api.saveSchedule(payload))
  ipcMain.handle(PAGE_WALL_FINITE_IPC.deleteSchedule, (_event, payload: PageWallFinitePlanIdsPayload) => api.deleteSchedule(payload))

  // Resume pending finite occurrences after an app restart. Legacy recovery may have
  // marked a consequential running job failed; those occurrences are finalized below.
  const pending = database.prepare("SELECT id FROM page_wall_plan_occurrences WHERE status = 'pending' ORDER BY scheduled_at, id").all() as Array<{ id: number }>
  for (const row of pending) {
    const occurrence = plans.getOccurrence(row.id)
    if (occurrence) launchOccurrence({ occurrence, jobs: plans.listOccurrenceJobs(occurrence.id) })
  }

  void tick()
  const timer = setInterval(() => void tick(), 1_000)

  return {
    dispose: () => {
      disposed = true
      clearInterval(timer)
      for (const channel of Object.values(PAGE_WALL_FINITE_IPC)) ipcMain.removeHandler(channel)
      posting.closeAll()
    }
  }
}
