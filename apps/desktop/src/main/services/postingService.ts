import type Database from 'better-sqlite3'
import type { AccountRecord } from '../../shared/accounts'
import {
  DEFAULT_APP_SETTINGS,
  type BrowserSettings,
  type NetworkSettings,
  type SessionSettings
} from '../../shared/appSettings'
import type {
  ExecuteSinglePostingJobPayload,
  ExecuteSinglePostingJobResult,
  PostingJobResult
} from '../../shared/posting'
import { accountProfileDirectory } from '../browser/browserProfileManager'
import { resolveAccountProxyState } from '../browser/proxyConfig'
import { PostingWorkerManager } from '../browser/postingWorkerManager'
import { AccountRepository } from '../database/accountRepository'
import { RunRepository } from '../database/runRepository'
import { redactExecutionText } from './executionLogSanitizer'
import { selectRunContent, selectRunImages } from './postingSelection'

function accountSecrets(account: AccountRecord): Array<string | null | undefined> {
  return [account.password, account.cookie, account.twoFactorSecret, account.emailPassword, account.proxy, account.proxyPassword]
}

function terminalFailure(message: string, code: NonNullable<PostingJobResult['code']> = 'unexpected_error'): PostingJobResult {
  return { status: 'failed', code, message }
}

function hasInvalidSession(result: PostingJobResult): boolean {
  return result.status === 'needs_login'
    || result.sessionValidation?.state === 'needs_login'
    || result.sessionValidation?.state === 'verification_required'
}

function shouldReleasePreflightItem(result: PostingJobResult): boolean {
  return (result.status === 'needs_login' && result.sessionValidation?.phase === 'before_run')
    || result.code === 'proxy_unavailable'
}

export class PostingService {
  private readonly accounts: AccountRepository
  private readonly runs: RunRepository
  private readonly workers: PostingWorkerManager

  constructor(
    database: Database.Database,
    private readonly dataDirectory: string,
    private readonly getBrowserSettings: () => BrowserSettings = () => ({ ...DEFAULT_APP_SETTINGS.browser }),
    private readonly getSessionSettings: () => SessionSettings = () => ({ ...DEFAULT_APP_SETTINGS.session }),
    private readonly getNetworkSettings: () => NetworkSettings = () => ({ ...DEFAULT_APP_SETTINGS.network })
  ) {
    this.accounts = new AccountRepository(database)
    this.runs = new RunRepository(database)
    this.workers = new PostingWorkerManager()
  }

  async executeSingle(payload: ExecuteSinglePostingJobPayload): Promise<ExecuteSinglePostingJobResult> {
    let details = this.runs.get(payload.runId)
    if (!details) throw new Error(`Không tìm thấy run #${payload.runId}.`)
    if (details.run.status === 'created' || details.run.status === 'paused') details = this.runs.resume(payload.runId)
    if (details.run.status !== 'running') throw new Error(`Run #${payload.runId} không ở trạng thái running.`)

    const enabledAccounts = details.run.snapshot.accounts.filter((account) => account.enabled).sort((a, b) => a.sortOrder - b.sortOrder)
    const selectedRef = payload.accountId === undefined ? enabledAccounts[0] : enabledAccounts.find((account) => account.accountId === payload.accountId)
    if (!selectedRef) return { accountId: null, item: null, result: terminalFailure('Run không có account enabled phù hợp.', 'no_enabled_account'), run: details }

    const account = this.accounts.getById(selectedRef.accountId)
    if (!account || account.status === 'disabled') return { accountId: selectedRef.accountId, item: null, result: terminalFailure('Account không tồn tại hoặc đang disabled.', 'account_disabled'), run: details }
    if (account.status === 'needs_login') return { accountId: account.id, item: null, result: { status: 'needs_login', code: 'needs_login', message: 'Account đang cần đăng nhập/xác minh thủ công.' }, run: details }

    const proxyResolution = resolveAccountProxyState(account)
    if (proxyResolution.status === 'invalid') {
      return {
        accountId: account.id,
        item: null,
        result: terminalFailure(proxyResolution.message, 'proxy_invalid'),
        run: details
      }
    }
    const proxy = proxyResolution.status === 'valid' ? proxyResolution.proxy : undefined

    const item = this.runs.claimNext(payload.runId)
    if (!item) {
      const current = this.runs.get(payload.runId)
      if (!current) throw new Error(`Không tìm thấy run #${payload.runId} sau khi claim queue.`)
      return { accountId: account.id, item: null, result: terminalFailure('Run không còn pending item.', 'no_pending_item'), run: current }
    }

    const content = selectRunContent(details.run.snapshot, item)
    if (!content) {
      const run = this.runs.completeItem({ runId: payload.runId, itemId: item.id, status: 'failed', errorMessage: 'Content Set không có nội dung hợp lệ.' })
      return { accountId: account.id, item, result: terminalFailure('Content Set không có nội dung hợp lệ.', 'no_content'), run }
    }

    const images = await selectRunImages(details.run.snapshot.image, item)
    if (images.missing && details.run.snapshot.image.missingPolicy === 'skip') {
      const run = this.runs.completeItem({ runId: payload.runId, itemId: item.id, status: 'skipped' })
      return { accountId: account.id, item, result: { status: 'skipped', code: 'missing_media', message: 'Thiếu ảnh theo cấu hình; item được skip trong run hiện tại.' }, run }
    }

    const sessionSettings = { ...this.getSessionSettings() }
    const networkSettings = { ...this.getNetworkSettings() }
    const workerResult = await this.workers.run({
      runId: payload.runId,
      itemId: item.id,
      accountId: account.id,
      profileDirectory: accountProfileDirectory(this.dataDirectory, account.id),
      pageUid: details.run.pageUid,
      groupUid: item.groupUid,
      content,
      imagePaths: images.paths,
      browser: { ...this.getBrowserSettings() },
      session: sessionSettings,
      network: networkSettings,
      sessionAccount: {
        id: account.id,
        uid: account.uid,
        username: account.username,
        password: account.password,
        cookie: account.cookie,
        twoFactorSecret: account.twoFactorSecret
      },
      ...(account.userAgent ? { userAgent: account.userAgent } : {}),
      ...(proxy ? { proxy } : {})
    })
    const safeMessage = redactExecutionText(workerResult.message, accountSecrets(account)) ?? 'Unknown error'
    const safeValidation = workerResult.sessionValidation
      ? {
          ...workerResult.sessionValidation,
          message: redactExecutionText(workerResult.sessionValidation.message, accountSecrets(account)) ?? 'Session validation failed.'
        }
      : undefined
    const result: PostingJobResult = {
      ...workerResult,
      message: safeMessage,
      ...(safeValidation ? { sessionValidation: safeValidation } : {})
    }

    const now = Date.now()
    if (hasInvalidSession(result)) {
      this.accounts.update(account.id, {
        status: 'needs_login',
        cookieStatus: 'needs_login',
        lastCookieCheck: now,
        lastUsedAt: now
      })
    } else if (result.status === 'success') {
      const sessionWasChecked = sessionSettings.validateBeforeRun || sessionSettings.validateAfterRun
      this.accounts.update(account.id, {
        status: 'valid',
        ...(sessionWasChecked ? { cookieStatus: 'valid' as const, lastCookieCheck: now } : {}),
        lastUsedAt: now
      })
    } else {
      this.accounts.update(account.id, { lastUsedAt: now })
    }

    if (shouldReleasePreflightItem(result)) {
      const run = this.runs.releaseItem({
        runId: payload.runId,
        itemId: item.id,
        errorMessage: result.message
      })
      return { accountId: account.id, item: null, result, run }
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
