import type { ExecutionLogFilters, ExecutionLogRecord } from '../../shared/executionLogs'
import type { PageTabConfig, PageTabSummary } from '../../shared/pageTabs'
import {
  PWA_BRIDGE_SCHEMA_VERSION,
  PWA_BRIDGE_STALE_AFTER_MS,
  type PwaBridgeAccountSnapshot,
  type PwaBridgeLogSnapshot,
  type PwaBridgePageSnapshot,
  type PwaBridgeScheduleSnapshot,
  type PwaBridgeSnapshot
} from '../../shared/pwaBridge'
import type { RotationRuntimeSnapshot, RotationRuntimeStatus } from '../../shared/rotation'
import { redactExecutionText } from './executionLogSanitizer'

export interface PwaBridgePageTabSource {
  list(): PageTabSummary[]
  get(id: number): PageTabConfig | null
}

export interface PwaBridgeRotationSource {
  status(payload: { pageTabId: number }): RotationRuntimeSnapshot
}

export interface PwaBridgeExecutionLogSource {
  list(filters?: ExecutionLogFilters): ExecutionLogRecord[]
}

const ACTIVE_STATUSES = new Set<RotationRuntimeStatus>(['starting', 'running', 'waiting_window', 'stopping'])

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function safeText(value: string | null | undefined): string | null {
  return redactExecutionText(value, [])
}

function groupLogs(logs: ExecutionLogRecord[], pageIds: Set<number>): ExecutionLogRecord[] {
  return logs.filter((log) => log.pageTabId !== null && pageIds.has(log.pageTabId) && Boolean(log.groupUid))
}

function accountSnapshots(config: PageTabConfig, runtime: RotationRuntimeSnapshot): PwaBridgeAccountSnapshot[] {
  const runtimeById = new Map((runtime.accountStates ?? []).map((state) => [state.accountId, state]))
  return config.accounts
    .filter((account) => account.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((account) => {
      const state = runtimeById.get(account.accountId)
      return {
        accountId: account.accountId,
        uid: account.uid,
        name: account.name,
        status: state?.status ?? 'not_run',
        message: safeText(state?.message)
      }
    })
}

function scheduleSnapshots(config: PageTabConfig, runtime: RotationRuntimeSnapshot): PwaBridgeScheduleSnapshot[] {
  const windowStates = runtime.windowStates ?? []
  return config.schedules
    .filter((schedule) => schedule.enabled)
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute || a.sortOrder - b.sortOrder)
    .map((schedule) => {
      const state = windowStates.find((entry) => (
        entry.dayOfWeek === schedule.dayOfWeek
        && entry.startMinute === schedule.startMinute
        && entry.endMinute === schedule.endMinute
      ))
      return {
        dayOfWeek: schedule.dayOfWeek,
        startMinute: schedule.startMinute,
        endMinute: schedule.endMinute,
        status: state?.status ?? null,
        currentAccountId: state?.currentAccountId ?? null,
        groupRemaining: state?.groupRemaining ?? null
      }
    })
}

function logSnapshot(log: ExecutionLogRecord): PwaBridgeLogSnapshot {
  return {
    id: log.id,
    timestamp: log.timestamp,
    pageTabId: log.pageTabId as number,
    accountId: log.accountId,
    pageUid: log.pageUid,
    groupUid: log.groupUid as string,
    action: log.action,
    result: log.result,
    errorCode: log.errorCode,
    errorMessage: safeText(log.errorMessage),
    publishedUrl: log.publishedUrl
  }
}

export class PwaBridgeService {
  constructor(
    private readonly pageTabs: PwaBridgePageTabSource,
    private readonly rotation: PwaBridgeRotationSource,
    private readonly executionLogs: PwaBridgeExecutionLogSource,
    private readonly now: () => number = () => Date.now()
  ) {}

  getSnapshot(): PwaBridgeSnapshot {
    const generatedAt = this.now()
    const summaries = this.pageTabs.list()
    const pageIds = new Set(summaries.map((page) => page.id))
    const todayLogs = groupLogs(this.executionLogs.list({ fromTimestamp: startOfLocalDay(generatedAt), limit: 1000 }), pageIds)
    const recentLogs = groupLogs(this.executionLogs.list({ limit: 100 }), pageIds).slice(0, 30)
    const todayByPage = new Map<number, { success: number; failed: number }>()

    for (const log of todayLogs) {
      if (log.pageTabId === null) continue
      const current = todayByPage.get(log.pageTabId) ?? { success: 0, failed: 0 }
      if (log.result === 'success') current.success += 1
      else if (log.result === 'failed' || log.errorCode !== null) current.failed += 1
      todayByPage.set(log.pageTabId, current)
    }

    const pages = summaries.map((summary): PwaBridgePageSnapshot => {
      const config = this.pageTabs.get(summary.id)
      let runtime: RotationRuntimeSnapshot
      try {
        runtime = this.rotation.status({ pageTabId: summary.id })
      } catch (error) {
        runtime = {
          pageTabId: summary.id,
          runId: null,
          status: 'error',
          currentAccountId: null,
          currentAccountIndex: null,
          slotsCompletedThisTurn: 0,
          targetSlotsThisTurn: 0,
          cycle: 0,
          nextActionAt: null,
          message: safeText(error instanceof Error ? error.message : String(error)),
          lastResult: null,
          run: null
        }
      }

      const today = todayByPage.get(summary.id) ?? { success: 0, failed: 0 }
      const metrics = runtime.run?.metrics ?? null
      const currentPost = runtime.currentPostPreview
        ? {
            groupUid: runtime.currentPostPreview.groupUid,
            contentPreview: safeText(runtime.currentPostPreview.contentPreview) ?? '',
            contentLength: runtime.currentPostPreview.contentLength,
            imageCount: runtime.currentPostPreview.imageCount,
            postIndex: runtime.currentPostPreview.postIndex,
            variantIndex: runtime.currentPostPreview.variantIndex
          }
        : null

      return {
        pageTabId: summary.id,
        name: summary.name,
        pageUid: summary.pageUid,
        avatarDataUrl: config?.avatarDataUrl ?? null,
        configuredStatus: summary.status,
        runtimeStatus: runtime.status,
        runId: runtime.runId,
        runStatus: runtime.run?.run.status ?? null,
        message: safeText(runtime.message),
        accountCount: summary.accountCount,
        groupCount: summary.groupCount,
        accountConcurrency: config?.rotation.accountConcurrency ?? 1,
        postsPerAccount: config?.rotation.postsPerAccount ?? 1,
        currentAccountId: runtime.currentAccountId,
        currentGroupUid: currentPost?.groupUid ?? null,
        nextActionAt: runtime.nextActionAt,
        cycle: runtime.cycle,
        slotsCompletedThisTurn: runtime.slotsCompletedThisTurn,
        targetSlotsThisTurn: runtime.targetSlotsThisTurn,
        progress: metrics
          ? {
              total: metrics.total,
              success: metrics.success,
              failed: metrics.failed,
              skipped: metrics.skipped,
              remaining: metrics.remaining,
              percent: metrics.progressPercent
            }
          : null,
        today,
        accounts: config ? accountSnapshots(config, runtime) : [],
        schedules: config ? scheduleSnapshots(config, runtime) : [],
        currentPost
      }
    })

    const futureActions = pages
      .map((page) => page.nextActionAt)
      .filter((value): value is number => value !== null && value >= generatedAt)

    return {
      schemaVersion: PWA_BRIDGE_SCHEMA_VERSION,
      generatedAt,
      staleAfterMs: PWA_BRIDGE_STALE_AFTER_MS,
      summary: {
        totalPages: pages.length,
        activePages: pages.filter((page) => ACTIVE_STATUSES.has(page.runtimeStatus)).length,
        pausedPages: pages.filter((page) => page.runtimeStatus === 'paused').length,
        successToday: todayLogs.filter((log) => log.result === 'success').length,
        failedToday: todayLogs.filter((log) => log.result === 'failed' || log.errorCode !== null).length,
        nextActionAt: futureActions.length > 0 ? Math.min(...futureActions) : null
      },
      pages,
      recentLogs: recentLogs.map(logSnapshot)
    }
  }
}
