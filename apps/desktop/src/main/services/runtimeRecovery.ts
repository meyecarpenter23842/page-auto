import type Database from 'better-sqlite3'
import type { RetryRunItemResult } from '../../shared/executionLogs'
import { ExecutionLogRepository } from '../database/executionLogRepository'
import { RunRepository } from '../database/runRepository'
import { canQueueRetry, MAX_RETRY_ATTEMPTS } from './retryPolicy'

const RECOVERY_ERROR_CODE = 'recovery_unconfirmed'
const RECOVERY_MESSAGE = 'App/worker dừng khi item đang processing; chưa có bằng chứng publish success nên item cần review và không tự retry.'

interface InterruptedItemRow {
  itemId: number
  runId: number
  attemptCount: number
  pageTabId: number | null
  pageUid: string
  groupUid: string
}

interface RunningRunRow {
  runId: number
  pageTabId: number | null
}

export interface RuntimeRecoverySummary {
  pausedRuns: number
  reviewItems: number
}

export class RuntimeRecoveryService {
  private readonly runs: RunRepository

  constructor(
    private readonly client: Database.Database,
    private readonly logs: ExecutionLogRepository
  ) {
    this.runs = new RunRepository(client)
  }

  recoverInterruptedRuns(): RuntimeRecoverySummary {
    const recover = this.client.transaction(() => {
      const now = Date.now()
      const interruptedItems = this.client.prepare(`
        SELECT
          ri.id AS itemId,
          ri.run_id AS runId,
          ri.attempt_count AS attemptCount,
          r.page_tab_id AS pageTabId,
          r.page_uid AS pageUid,
          ri.group_uid AS groupUid
        FROM run_items ri
        JOIN runs r ON r.id = ri.run_id
        WHERE ri.status = 'processing'
          AND r.status IN ('created', 'running', 'paused')
        ORDER BY ri.run_id, ri.id
      `).all() as InterruptedItemRow[]

      for (const item of interruptedItems) {
        this.client.prepare(`
          UPDATE run_items
          SET status = 'failed', last_error = ?, finished_at = ?, updated_at = ?
          WHERE id = ? AND status = 'processing'
        `).run(RECOVERY_MESSAGE, now, now, item.itemId)

        this.addRunEvent(item.runId, 'item_recovery_review_required', {
          itemId: item.itemId,
          groupUid: item.groupUid,
          attemptCount: item.attemptCount,
          reason: RECOVERY_ERROR_CODE
        }, now)

        this.logs.insert({
          timestamp: now,
          runId: item.runId,
          runItemId: item.itemId,
          pageTabId: item.pageTabId,
          accountId: null,
          pageUid: item.pageUid,
          groupUid: item.groupUid,
          contentIndex: null,
          imagePaths: [],
          action: 'recovery',
          result: 'failed',
          errorCode: RECOVERY_ERROR_CODE,
          errorMessage: RECOVERY_MESSAGE,
          screenshotPath: null,
          publishedUrl: null,
          attemptCount: item.attemptCount,
          retryDisposition: 'manual_review'
        })
      }

      const runningRuns = this.client.prepare(`
        SELECT id AS runId, page_tab_id AS pageTabId
        FROM runs
        WHERE status = 'running'
        ORDER BY id
      `).all() as RunningRunRow[]

      let pausedRuns = 0
      for (const run of runningRuns) {
        const remaining = this.client.prepare(`
          SELECT COUNT(*) AS count
          FROM run_items
          WHERE run_id = ? AND status IN ('pending', 'processing')
        `).get(run.runId) as { count: number }

        if (remaining.count === 0) {
          this.client.prepare(`
            UPDATE runs
            SET status = 'completed', completed_at = ?, paused_at = NULL, updated_at = ?
            WHERE id = ? AND status = 'running'
          `).run(now, now, run.runId)
          if (run.pageTabId !== null) {
            this.client.prepare(`UPDATE page_tabs SET status = 'idle', updated_at = ? WHERE id = ?`)
              .run(now, run.pageTabId)
          }
          this.addRunEvent(run.runId, 'run_recovery_completed', {
            reason: 'app_restart',
            reviewItems: interruptedItems.filter((item) => item.runId === run.runId).length
          }, now)
          continue
        }

        this.client.prepare(`
          UPDATE runs
          SET status = 'paused', paused_at = ?, updated_at = ?
          WHERE id = ? AND status = 'running'
        `).run(now, now, run.runId)
        if (run.pageTabId !== null) {
          this.client.prepare(`
            UPDATE page_tabs SET status = 'paused', updated_at = ? WHERE id = ?
          `).run(now, run.pageTabId)
        }
        this.addRunEvent(run.runId, 'run_recovered_paused', {
          reason: 'app_restart',
          reviewItems: interruptedItems.filter((item) => item.runId === run.runId).length
        }, now)
        pausedRuns += 1
      }

      return { pausedRuns, reviewItems: interruptedItems.length }
    })

    return recover()
  }

  retryFailedItem(runItemId: number): RetryRunItemResult {
    const retry = this.client.transaction(() => {
      const row = this.client.prepare(`
        SELECT
          ri.id AS itemId,
          ri.run_id AS runId,
          ri.status,
          ri.attempt_count AS attemptCount,
          r.status AS runStatus,
          r.page_tab_id AS pageTabId
        FROM run_items ri
        JOIN runs r ON r.id = ri.run_id
        WHERE ri.id = ?
      `).get(runItemId) as {
        itemId: number
        runId: number
        status: string
        attemptCount: number
        runStatus: string
        pageTabId: number | null
      } | undefined

      if (!row) throw new Error(`Không tìm thấy run item #${runItemId}.`)
      if (row.status !== 'failed') throw new Error('Chỉ có thể queue retry cho item đang failed.')
      if (row.runStatus === 'stopped' || row.runStatus === 'failed') {
        throw new Error('Run đã stopped/failed; không queue retry vào run này.')
      }

      const latestLog = this.logs.getLatestForRunItem(runItemId)
      const errorCode = latestLog?.errorCode ?? null
      if (!canQueueRetry(errorCode, row.attemptCount)) {
        const reason = latestLog?.retryDisposition === 'manual_review'
          ? 'Item cần review thủ công để tránh đăng trùng.'
          : row.attemptCount >= MAX_RETRY_ATTEMPTS
            ? `Item đã đạt giới hạn ${MAX_RETRY_ATTEMPTS} attempt.`
            : 'Lỗi hiện tại không nằm trong retry policy an toàn.'
        throw new Error(reason)
      }

      const now = Date.now()
      this.client.prepare(`
        UPDATE run_items
        SET status = 'pending', last_error = NULL, started_at = NULL, finished_at = NULL, updated_at = ?
        WHERE id = ? AND status = 'failed'
      `).run(now, runItemId)

      if (row.runStatus === 'completed') {
        this.client.prepare(`
          UPDATE runs
          SET status = 'paused', paused_at = ?, completed_at = NULL, updated_at = ?
          WHERE id = ?
        `).run(now, now, row.runId)
        if (row.pageTabId !== null) {
          this.client.prepare(`UPDATE page_tabs SET status = 'paused', updated_at = ? WHERE id = ?`)
            .run(now, row.pageTabId)
        }
      }

      this.addRunEvent(row.runId, 'item_retry_queued', {
        itemId: row.itemId,
        previousErrorCode: errorCode,
        attemptCount: row.attemptCount
      }, now)

      const previous = latestLog
      this.logs.insert({
        timestamp: now,
        runId: row.runId,
        runItemId: row.itemId,
        pageTabId: previous?.pageTabId ?? row.pageTabId,
        accountId: previous?.accountId ?? null,
        pageUid: previous?.pageUid ?? null,
        groupUid: previous?.groupUid ?? null,
        contentIndex: previous?.contentIndex ?? null,
        imagePaths: previous?.imagePaths ?? [],
        action: 'retry_queued',
        result: 'pending',
        errorCode: null,
        errorMessage: null,
        screenshotPath: previous?.screenshotPath ?? null,
        publishedUrl: null,
        attemptCount: row.attemptCount,
        retryDisposition: 'not_applicable'
      })

      return row.runId
    })

    const runId = retry()
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Không tìm thấy run #${runId} sau khi queue retry.`)
    return {
      itemId: runItemId,
      run,
      message: 'Đã đưa item về hàng pending an toàn. Resume Page Tab để chạy lại.'
    }
  }

  private addRunEvent(runId: number, eventType: string, payload: unknown, createdAt: number): void {
    this.client.prepare(`
      INSERT INTO run_events (run_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(runId, eventType, JSON.stringify(payload), createdAt)
  }
}
