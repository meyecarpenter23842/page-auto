import type Database from 'better-sqlite3'
import { DEFAULT_APP_SETTINGS, type LoggingSettings, type RuntimeSettings } from '../../shared/appSettings'
import type { ExecuteSinglePostingJobPayload, ExecuteSinglePostingJobResult } from '../../shared/posting'
import { AccountRepository } from '../database/accountRepository'
import { ExecutionLogRepository } from '../database/executionLogRepository'
import { selectRunContent, selectRunImages } from './postingSelection'
import { redactExecutionText } from './executionLogSanitizer'
import { shouldPersistPostingAttempt } from './loggingPolicy'
import { canQueueRetryWithRuntime, retryDispositionFor } from './retryPolicy'
import { RuntimeRecoveryService } from './runtimeRecovery'
import { ConsecutiveFailureTracker } from './runtimeFailureTracker'

export interface PostingExecutor {
  executeSingle(payload: ExecuteSinglePostingJobPayload): Promise<ExecuteSinglePostingJobResult>
}

function contentIndex(result: ExecuteSinglePostingJobResult): number | null {
  if (!result.item) return null
  const selected = selectRunContent(result.run.run.snapshot, result.item)
  if (!selected) return null
  const normalized = result.run.run.snapshot.contents.map((value) => value.trim())
  const index = normalized.findIndex((value) => value === selected.trim())
  return index < 0 ? null : index + 1
}

function retryDelay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export class ResilientPostingService implements PostingExecutor {
  private readonly accounts: AccountRepository
  private readonly recovery: RuntimeRecoveryService
  private readonly consecutiveFailures = new ConsecutiveFailureTracker()

  constructor(
    private readonly core: PostingExecutor,
    database: Database.Database,
    private readonly logs: ExecutionLogRepository,
    private readonly getRuntimeSettings: () => RuntimeSettings = () => ({ ...DEFAULT_APP_SETTINGS.runtime }),
    private readonly getLoggingSettings: () => LoggingSettings = () => ({ ...DEFAULT_APP_SETTINGS.logging })
  ) {
    this.accounts = new AccountRepository(database)
    this.recovery = new RuntimeRecoveryService(database, logs)
  }

  async executeSingle(payload: ExecuteSinglePostingJobPayload): Promise<ExecuteSinglePostingJobResult> {
    let nextPayload = payload

    while (true) {
      const outcome = await this.core.executeSingle(nextPayload)
      const runtime = { ...this.getRuntimeSettings() }
      const logging = { ...this.getLoggingSettings() }
      const item = outcome.item
      const willRetry = Boolean(
        item
        && outcome.result.status === 'failed'
        && canQueueRetryWithRuntime(outcome.result.code, item.attemptCount, runtime)
      )

      if (shouldPersistPostingAttempt(logging.level, outcome, willRetry)) {
        await this.writeAttemptLog(outcome)
      }

      if (willRetry && item) {
        try {
          this.recovery.retryFailedItem(item.id)
        } catch {
          if (logging.level === 'normal') await this.writeAttemptLog(outcome)
          return this.applyConsecutiveFailureLimit(payload, outcome, runtime)
        }

        await retryDelay(runtime.retryDelayMs)
        nextPayload = outcome.accountId === null
          ? { runId: payload.runId }
          : { runId: payload.runId, accountId: outcome.accountId }
        continue
      }

      return this.applyConsecutiveFailureLimit(payload, outcome, runtime)
    }
  }

  private applyConsecutiveFailureLimit(
    payload: ExecuteSinglePostingJobPayload,
    outcome: ExecuteSinglePostingJobResult,
    runtime: RuntimeSettings
  ): ExecuteSinglePostingJobResult {
    if (payload.accountId === undefined) return outcome

    const decision = this.consecutiveFailures.record(
      outcome.run.run.id,
      outcome.accountId,
      outcome.result.status,
      Boolean(outcome.item),
      runtime.consecutiveFailureLimit
    )
    if (!decision.limitReached || outcome.accountId === null) return outcome

    return {
      ...outcome,
      item: null,
      result: {
        ...outcome.result,
        message: `Account #${outcome.accountId} đạt ${decision.count} lỗi posting liên tiếp; chuyển account để tránh kẹt runtime. Lỗi cuối: ${outcome.result.message}`
      }
    }
  }

  private async writeAttemptLog(outcome: ExecuteSinglePostingJobResult): Promise<void> {
    const item = outcome.item
    const account = outcome.accountId === null ? null : this.accounts.getById(outcome.accountId)
    const secrets = account ? [
      account.password,
      account.cookie,
      account.twoFactorSecret,
      account.emailPassword,
      account.proxy,
      account.proxyPassword
    ] : []
    const images = item
      ? await selectRunImages(outcome.run.run.snapshot.image, item)
      : { paths: [], missing: false }

    this.logs.insert({
      runId: outcome.run.run.id,
      runItemId: item?.id ?? null,
      pageTabId: outcome.run.run.pageTabId,
      accountId: outcome.accountId,
      pageUid: outcome.run.run.pageUid,
      groupUid: item?.groupUid ?? null,
      contentIndex: contentIndex(outcome),
      imagePaths: images.paths,
      action: 'posting_attempt',
      result: outcome.result.status,
      errorCode: outcome.result.code ?? null,
      errorMessage: redactExecutionText(outcome.result.message, secrets),
      screenshotPath: outcome.result.screenshotPath ?? null,
      publishedUrl: outcome.result.publishedUrl ?? null,
      attemptCount: item?.attemptCount ?? 0,
      retryDisposition: retryDispositionFor(outcome.result.code)
    })
  }
}
