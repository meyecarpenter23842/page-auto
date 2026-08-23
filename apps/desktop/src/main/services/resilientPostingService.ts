import type Database from 'better-sqlite3'
import type { ExecuteSinglePostingJobPayload, ExecuteSinglePostingJobResult } from '../../shared/posting'
import { AccountRepository } from '../database/accountRepository'
import { ExecutionLogRepository } from '../database/executionLogRepository'
import { selectRunContent, selectRunImages } from './postingSelection'
import { redactExecutionText } from './executionLogSanitizer'
import { MAX_RETRY_ATTEMPTS, retryDispositionFor } from './retryPolicy'
import { RuntimeRecoveryService } from './runtimeRecovery'

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

function retryDelay(attemptCount: number): Promise<void> {
  const milliseconds = Math.min(1_500, Math.max(250, attemptCount * 500))
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export class ResilientPostingService implements PostingExecutor {
  private readonly accounts: AccountRepository
  private readonly recovery: RuntimeRecoveryService

  constructor(
    private readonly core: PostingExecutor,
    database: Database.Database,
    private readonly logs: ExecutionLogRepository
  ) {
    this.accounts = new AccountRepository(database)
    this.recovery = new RuntimeRecoveryService(database, logs)
  }

  async executeSingle(payload: ExecuteSinglePostingJobPayload): Promise<ExecuteSinglePostingJobResult> {
    let nextPayload = payload

    while (true) {
      const outcome = await this.core.executeSingle(nextPayload)
      await this.writeAttemptLog(outcome)

      const item = outcome.item
      const disposition = retryDispositionFor(outcome.result.code)
      if (
        !item ||
        outcome.result.status !== 'failed' ||
        disposition !== 'retryable' ||
        item.attemptCount >= MAX_RETRY_ATTEMPTS
      ) {
        return outcome
      }

      try {
        this.recovery.retryFailedItem(item.id)
      } catch {
        return outcome
      }

      await retryDelay(item.attemptCount)
      nextPayload = outcome.accountId === null
        ? { runId: payload.runId }
        : { runId: payload.runId, accountId: outcome.accountId }
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
