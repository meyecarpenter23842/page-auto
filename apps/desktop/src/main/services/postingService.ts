import type { AccountRecord } from '../../shared/accounts'
import type {
  ExecuteSinglePostingJobPayload,
  ExecuteSinglePostingJobResult,
  PostingJobResult,
  PostingProxyConfig
} from '../../shared/posting'
import { accountProfileDirectory } from '../browser/browserProfileManager'
import { PostingWorkerManager } from '../browser/postingWorkerManager'
import { AccountRepository } from '../database/accountRepository'
import { RunRepository } from '../database/runRepository'
import type Database from 'better-sqlite3'
import { redactExecutionText } from './executionLogSanitizer'
import { selectRunContent, selectRunImages } from './postingSelection'

function buildProxy(account: AccountRecord): PostingProxyConfig | undefined {
  if (!account.proxyHost || !account.proxyPort) return undefined
  const scheme = account.proxyType?.trim() || 'http'
  const server = `${scheme}://${account.proxyHost}:${account.proxyPort}`
  return {
    server,
    ...(account.proxyUsername ? { username: account.proxyUsername } : {}),
    ...(account.proxyPassword ? { password: account.proxyPassword } : {})
  }
}

function accountSecrets(account: AccountRecord): Array<string | null | undefined> {
  return [
    account.password,
    account.cookie,
    account.twoFactorSecret,
    account.emailPassword,
    account.proxyPassword
  ]
}

function terminalFailure(message: string, code: NonNullable<PostingJobResult['code']> = 'unexpected_error'): PostingJobResult {
  return { status: 'failed', code, message }
}

export class PostingService {
  private readonly accounts: AccountRepository
  private readonly runs: RunRepository
  private readonly workers: PostingWorkerManager

  constructor(
    database: Database.Database,
    private readonly dataDirectory: string
  ) {
    this.accounts = new AccountRepository(database)
    this.runs = new RunRepository(database)
    this.workers = new PostingWorkerManager()
  }

  async executeSingle(payload: ExecuteSinglePostingJobPayload): Promise<ExecuteSinglePostingJobResult> {
    let details = this.runs.get(payload.runId)
    if (!details) throw new Error(`Không tìm thấy run #${payload.runId}.`)

    if (details.run.status === 'created' || details.run.status === 'paused') {
      details = this.runs.resume(payload.runId)
    }
    if (details.run.status !== 'running') {
      throw new Error(`Run #${payload.runId} không ở trạng thái running.`)
    }

    const enabledAccounts = details.run.snapshot.accounts
      .filter((account) => account.enabled)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const selectedRef = payload.accountId === undefined
      ? enabledAccounts[0]
      : enabledAccounts.find((account) => account.accountId === payload.accountId)

    if (!selectedRef) {
      return {
        accountId: null,
        item: null,
        result: terminalFailure('Run không có account enabled phù hợp.', 'no_enabled_account'),
        run: details
      }
    }

    const account = this.accounts.getById(selectedRef.accountId)
    if (!account || account.status === 'disabled') {
      return {
        accountId: selectedRef.accountId,
        item: null,
        result: terminalFailure('Account không tồn tại hoặc đang disabled.', 'account_disabled'),
        run: details
      }
    }
    if (account.status === 'needs_login') {
      return {
        accountId: account.id,
        item: null,
        result: { status: 'needs_login', code: 'needs_login', message: 'Account đang cần đăng nhập/xác minh thủ công.' },
        run: details
      }
    }

    const item = this.runs.claimNext(payload.runId)
    if (!item) {
      const current = this.runs.get(payload.runId)
      if (!current) throw new Error(`Không tìm thấy run #${payload.runId} sau khi claim queue.`)
      return {
        accountId: account.id,
        item: null,
        result: terminalFailure('Run không còn pending item.', 'no_pending_item'),
        run: current
      }
    }

    const content = selectRunContent(details.run.snapshot, item)
    if (!content) {
      const run = this.runs.completeItem({
        runId: payload.runId,
        itemId: item.id,
        status: 'failed',
        errorMessage: 'Content Set không có nội dung hợp lệ.'
      })
      return { accountId: account.id, item, result: terminalFailure('Content Set không có nội dung hợp lệ.', 'no_content'), run }
    }

    const images = await selectRunImages(details.run.snapshot.image, item)
    if (images.missing && details.run.snapshot.image.missingPolicy === 'skip') {
      const run = this.runs.completeItem({ runId: payload.runId, itemId: item.id, status: 'skipped' })
      return {
        accountId: account.id,
        item,
        result: { status: 'skipped', code: 'missing_media', message: 'Thiếu ảnh theo cấu hình; item được skip trong run hiện tại.' },
        run
      }
    }

    const proxy = buildProxy(account)
    const workerResult = await this.workers.run({
      runId: payload.runId,
      itemId: item.id,
      accountId: account.id,
      profileDirectory: accountProfileDirectory(this.dataDirectory, account.id),
      pageUid: details.run.pageUid,
      groupUid: item.groupUid,
      content,
      imagePaths: images.paths,
      ...(account.userAgent ? { userAgent: account.userAgent } : {}),
      ...(proxy ? { proxy } : {})
    })
    const safeMessage = redactExecutionText(workerResult.message, accountSecrets(account)) ?? 'Unknown error'
    const result: PostingJobResult = safeMessage === workerResult.message
      ? workerResult
      : { ...workerResult, message: safeMessage }

    if (result.status === 'needs_login') {
      this.accounts.update(account.id, { status: 'needs_login', lastUsedAt: Date.now() })
    } else if (result.status === 'success') {
      this.accounts.update(account.id, { status: 'valid', lastUsedAt: Date.now() })
    } else {
      this.accounts.update(account.id, { lastUsedAt: Date.now() })
    }

    const run = this.runs.completeItem({
      runId: payload.runId,
      itemId: item.id,
      status: result.status === 'success' ? 'success' : result.status === 'skipped' ? 'skipped' : 'failed',
      ...(result.status === 'success' || result.status === 'skipped' ? {} : { errorMessage: result.message })
    })

    return { accountId: account.id, item, result, run }
  }

  closeAll(): void {
    this.workers.closeAll()
  }
}
