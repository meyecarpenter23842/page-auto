import type { PageWallRunNowPayload } from '../../shared/pageWall'
import {
  activePageWallRecurringWindow,
  normalizePageWallRecurringSchedules,
  pageWallRecurringOccurrenceKey,
  type PageWallRecurringPagePayload,
  type PageWallRecurringPlanRecord,
  type SavePageWallRecurringPlanInput
} from '../../shared/pageWallRecurring'
import { PageWallRecurringRepository } from '../database/pageWallRecurringRepository'
import type { PageWallPreparationResult } from './pageWallRunNowService'

interface PageWallRecurringPreparer {
  prepare(payload: PageWallRunNowPayload): Promise<PageWallPreparationResult>
}

interface PageWallRecurringOptions {
  pollIntervalMs?: number
  autoStart?: boolean
  now?: () => number
}

function runPayload(plan: PageWallRecurringPlanRecord): PageWallRunNowPayload {
  return {
    pageTabId: plan.pageTabId,
    accountId: plan.accountId,
    content: plan.content,
    imagePaths: [...plan.imagePaths],
    ...(plan.canonicalPost ? { canonicalPost: plan.canonicalPost } : {})
  }
}

function inputRunPayload(input: SavePageWallRecurringPlanInput): PageWallRunNowPayload {
  return {
    pageTabId: input.pageTabId,
    accountId: input.accountId,
    content: input.content,
    imagePaths: [...input.imagePaths],
    ...(input.canonicalPost ? { canonicalPost: input.canonicalPost } : {})
  }
}

export class PageWallRecurringService {
  private readonly pollIntervalMs: number
  private readonly now: () => number
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  private disposed = false

  constructor(
    private readonly repository: PageWallRecurringRepository,
    private readonly preparer: PageWallRecurringPreparer,
    private readonly wakeConcreteScheduler: () => void | Promise<void>,
    options: PageWallRecurringOptions = {}
  ) {
    this.pollIntervalMs = Math.max(1_000, Math.floor(options.pollIntervalMs ?? 10_000))
    this.now = options.now ?? (() => Date.now())
    if (options.autoStart !== false) this.start()
  }

  get(payload: PageWallRecurringPagePayload): PageWallRecurringPlanRecord | null {
    if (!Number.isInteger(payload.pageTabId) || payload.pageTabId <= 0) {
      throw new Error('Page của lịch Tường không hợp lệ.')
    }
    return this.repository.get(payload.pageTabId)
  }

  async save(input: SavePageWallRecurringPlanInput): Promise<PageWallRecurringPlanRecord> {
    const schedules = normalizePageWallRecurringSchedules(input.schedules)
    if (input.enabled && !schedules.some((schedule) => schedule.enabled)) {
      throw new Error('Lịch chạy đang bật cần ít nhất một khung giờ bật.')
    }

    // Reuse the same Main preparation contract as Run now / one-shot schedule. This
    // verifies canonical Page membership/account ownership and that the selected
    // source can currently be materialized, without persisting the temporary material.
    const preparation = await this.preparer.prepare(inputRunPayload(input))
    if (!preparation.ok) throw new Error(preparation.result.message)

    return this.repository.save({ ...input, schedules }, this.now())
  }

  clear(payload: PageWallRecurringPagePayload): boolean {
    return this.repository.clear(payload.pageTabId)
  }

  start(): void {
    if (this.disposed || this.timer) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs)
  }

  async tick(nowMs = this.now()): Promise<number> {
    if (this.disposed || this.ticking) return 0
    this.ticking = true
    let createdCount = 0
    try {
      const now = new Date(nowMs)
      for (const plan of this.repository.listEnabled()) {
        const window = activePageWallRecurringWindow(plan.schedules, now)
        if (!window) continue
        const occurrenceKey = pageWallRecurringOccurrenceKey(window, now)
        if (this.repository.occurrenceExists(plan.id, occurrenceKey)) continue

        const preparation = await this.preparer.prepare(runPayload(plan))
        if (!preparation.ok) {
          this.repository.setLastError(plan.id, preparation.result.message, nowMs)
          continue
        }

        const prepared = preparation.prepared
        const job = this.repository.createOccurrenceJob(plan.id, occurrenceKey, {
          // The window is active now. Persist a concrete due snapshot immediately;
          // the existing concrete scheduler owns concurrency and execution from here.
          scheduledAt: nowMs,
          pageTabId: plan.pageTabId,
          pageTabName: prepared.pageTabName,
          pageUid: prepared.input.pageUid,
          accountId: prepared.input.accountId,
          accountUid: prepared.accountUid,
          accountName: prepared.accountName,
          content: prepared.input.content,
          imagePaths: [...prepared.input.imagePaths]
        }, nowMs)
        if (!job) continue

        createdCount += 1
        this.repository.setLastError(plan.id, null, nowMs)
      }

      if (createdCount > 0) await this.wakeConcreteScheduler()
      return createdCount
    } finally {
      this.ticking = false
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
