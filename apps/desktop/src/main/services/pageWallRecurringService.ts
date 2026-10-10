import type { PageWallRunNowPayload } from '../../shared/pageWall'
import {
  normalizePageWallRecurringSchedules,
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

/**
 * Compatibility facade for databases/UI builds that still know the v21 recurring API.
 *
 * Batch 2.1C deliberately removes the v21 service from the automatic runtime path:
 * no timer is started and no occurrence is materialized here. The production recurring
 * path is now PageWallSchedulerService reading the page_wall_post business binding and
 * reusing the common Page schedule-window contract.
 */
export class PageWallRecurringService {
  private readonly now: () => number

  constructor(
    private readonly repository: PageWallRecurringRepository,
    private readonly preparer: PageWallRecurringPreparer,
    wakeConcreteScheduler: () => void | Promise<void>,
    options: PageWallRecurringOptions = {}
  ) {
    this.now = options.now ?? (() => Date.now())
    void wakeConcreteScheduler
    void options.pollIntervalMs
    void options.autoStart
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

    const preparation = await this.preparer.prepare({
      pageTabId: input.pageTabId,
      accountId: input.accountId,
      content: input.content,
      imagePaths: [...input.imagePaths],
      ...(input.canonicalPost ? { canonicalPost: input.canonicalPost } : {})
    })
    if (!preparation.ok) throw new Error(preparation.result.message)
    return this.repository.save({ ...input, schedules }, this.now())
  }

  clear(payload: PageWallRecurringPagePayload): boolean {
    return this.repository.clear(payload.pageTabId)
  }

  start(): void {
    // Intentionally inert. Kept only so old Main wiring can dispose safely during the
    // migration window without reviving the duplicate v21 recurring scheduler.
  }

  async tick(): Promise<number> {
    return 0
  }

  dispose(): void {
    // No timer/resources are owned by this compatibility facade.
  }
}
