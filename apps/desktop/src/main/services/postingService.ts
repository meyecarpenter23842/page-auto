import type Database from 'better-sqlite3'
import type { AccountRecord } from '../../shared/accounts'
import {
  DEFAULT_APP_SETTINGS,
  type BrowserSettings,
  type LoggingSettings,
  type NetworkSettings,
  type RuntimeSettings,
  type SessionSettings
} from '../../shared/appSettings'
import {
  cloneDefaultBrowserWindowLayout,
  type BrowserWindowLayoutSettings,
  type BrowserWindowPlacement
} from '../../shared/browserWindowLayout'
import {
  pageWallPostTaskFromBase,
  type FacebookPostTaskJobRequest,
  type FacebookTaskJobBase
} from '../../shared/facebookTasks'
import type { PageWallExecutionInput } from '../../shared/pageWall'
import type {
  ExecuteSinglePostingJobPayload,
  ExecuteSinglePostingJobResult,
  PostingJobResult
} from '../../shared/posting'
import { accountProfileDirectory } from '../browser/browserProfileManager'
import { BrowserWindowLayoutManager } from '../browser/browserWindowLayoutManager'
import { resolveAccountProxyState } from '../browser/proxyConfig'
import { PostingWorkerManager } from '../browser/postingWorkerManager'
import { AccountRepository } from '../database/accountRepository'
import { RunRepository } from '../database/runRepository'
import { redactExecutionText } from './executionLogSanitizer'
import { selectRunImages, selectRunPost } from './postingSelection'
import { rotationRuntimeOverlay } from './rotationRuntimeOverlay'

let manualPageWallSequence = 0

function nextManualPageWallItemId(): number {
  manualPageWallSequence = (manualPageWallSequence + 1) % 1000
  return (Date.now() * 1000) + manualPageWallSequence
}

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

function hasValidSession(result: PostingJobResult): boolean {
  return result.sessionValidation?.state === 'valid' || result.status === 'success'
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
    private readonly getNetworkSettings: () => NetworkSettings = () => ({ ...DEFAULT_APP_SETTINGS.network }),
    private readonly getRuntimeSettings: () => RuntimeSettings = () => ({ ...DEFAULT_APP_SETTINGS.runtime }),
    private readonly getLoggingSettings: () => LoggingSettings = () => ({ ...DEFAULT_APP_SETTINGS.logging }),
    private readonly releaseManagedBrowser: (accountId: number) => Promise<void> = async () => undefined,
    windowLayout?: BrowserWindowLayoutManager,
    getWindowLayoutSettings: () => BrowserWindowLayoutSettings = () => cloneDefaultBrowserWindowLayout()
  ) {
    this.accounts = new AccountRepository(database)
    this.runs = new RunRepository(database)
    this.workers = new PostingWorkerManager(this.getRuntimeSettings, windowLayout, getWindowLayoutSettings)
  }

  async executeSingle(payload: ExecuteSinglePostingJobPayload): Promise<ExecuteSinglePostingJobResult> {
    let details = this.runs.get(payload.runId)
    if (!details) throw new Error(`Không tìm thấy phiên #${payload.runId}.`)
    if (details.run.status === 'created' || details.run.status === 'paused') details = this.runs.resume(payload.runId)
    if (details.run.status !== 'running') throw new Error(`Phiên #${payload.runId} không ở trạng thái đang chạy.`)

    const enabledAccounts = details.run.snapshot.accounts.filter((account) => account.enabled).sort((a, b) => a.sortOrder - b.sortOrder)
    const selectedRef = payload.accountId === undefined ? enabledAccounts[0] : enabledAccounts.find((account) => account.accountId === payload.accountId)
    if (!selectedRef) return { accountId: null, item: null, result: terminalFailure('Phiên chạy không có tài khoản được bật phù hợp.', 'no_enabled_account'), run: details }

    const account = this.accounts.getById(selectedRef.accountId)
    if (!account || account.status === 'disabled') return { accountId: selectedRef.accountId, item: null, result: terminalFailure('Tài khoản không tồn tại hoặc đang bị tắt.', 'account_disabled'), run: details }

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
      if (!current) throw new Error(`Không tìm thấy phiên #${payload.runId} sau khi lấy hàng chờ.`)
      return { accountId: account.id, item: null, result: terminalFailure('Phiên chạy không còn Group chờ xử lý.', 'no_pending_item'), run: current }
    }

    const material = selectRunPost(details.run.snapshot, item)
    if (!material) {
      const run = this.runs.completeItem({ runId: payload.runId, itemId: item.id, status: 'failed', errorMessage: 'Thư viện bài viết không có bài hợp lệ.' })
      return { accountId: account.id, item, result: terminalFailure('Thư viện bài viết không có bài hợp lệ.', 'no_content'), run }
    }

    const images = await selectRunImages(material.image, item)
    if (images.missing && material.image.missingPolicy === 'skip') {
      const run = this.runs.completeItem({ runId: payload.runId, itemId: item.id, status: 'skipped' })
      return { accountId: account.id, item, result: { status: 'skipped', code: 'missing_media', message: 'Thiếu ảnh theo cấu hình của bài; Group được bỏ qua trong phiên hiện tại.' }, run }
    }

    rotationRuntimeOverlay.notePrepared(payload.runId, account.id, {
      groupUid: item.groupUid,
      contentPreview: material.content.slice(0, 600),
      contentLength: material.content.length,
      imageCount: images.paths.length,
      postIndex: material.postIndex,
      variantIndex: material.variantIndex
    })

    const sessionSettings = { ...this.getSessionSettings() }
    const networkSettings = { ...this.getNetworkSettings() }
    const loggingSettings = { ...this.getLoggingSettings() }
    const workerResult = await this.workers.run({
      runId: payload.runId,
      itemId: item.id,
      accountId: account.id,
      profileDirectory: accountProfileDirectory(this.dataDirectory, account.id),
      pageUid: details.run.pageUid,
      groupUid: item.groupUid,
      content: material.content,
      imagePaths: images.paths,
      browser: { ...this.getBrowserSettings() },
      session: sessionSettings,
      network: networkSettings,
      logging: loggingSettings,
      sessionAccount: {
        id: account.id,
        uid: account.uid,
        username: account.username,
        password: account.password,
        cookie: account.cookie,
        twoFactorSecret: account.twoFactorSecret,
        name: account.name
      },
      ...(account.userAgent ? { userAgent: account.userAgent } : {}),
      ...(proxy ? { proxy } : {})
    })

    const result = this.syncWorkerResult(account, workerResult)

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

  async executePageWallPostNow(input: PageWallExecutionInput): Promise<PostingJobResult> {
    const account = this.accounts.getById(input.accountId)
    if (!account || account.status === 'disabled') {
      return terminalFailure('Tài khoản không tồn tại hoặc đang bị tắt.', 'account_disabled')
    }

    const pageUid = input.pageUid.trim()
    if (!pageUid) return terminalFailure('Page UID không hợp lệ.', 'page_navigation_failed')

    const base: FacebookTaskJobBase = {
      runId: 0,
      itemId: nextManualPageWallItemId(),
      accountId: account.id,
      profileDirectory: accountProfileDirectory(this.dataDirectory, account.id),
      pageUid,
      content: input.content,
      imagePaths: [...input.imagePaths],
      browser: { ...this.getBrowserSettings() },
      session: { ...this.getSessionSettings() },
      network: { ...this.getNetworkSettings() },
      logging: { ...this.getLoggingSettings() },
      sessionAccount: {
        id: account.id,
        uid: account.uid,
        username: account.username,
        password: account.password,
        cookie: account.cookie,
        twoFactorSecret: account.twoFactorSecret,
        name: account.name
      }
    }

    return this.executeFacebookPostTask(pageWallPostTaskFromBase(base))
  }

  async executeFacebookPostTask(job: FacebookPostTaskJobRequest): Promise<PostingJobResult> {
    const account = this.accounts.getById(job.accountId)
    if (!account || account.status === 'disabled') {
      return terminalFailure('Tài khoản không tồn tại hoặc đang bị tắt.', 'account_disabled')
    }
    if (job.sessionAccount.id !== account.id || job.sessionAccount.uid.trim() !== account.uid.trim()) {
      return terminalFailure('Facebook task job không khớp account canonical trong Main process.')
    }

    const proxyResolution = resolveAccountProxyState(account)
    if (proxyResolution.status === 'invalid') {
      return terminalFailure(proxyResolution.message, 'proxy_invalid')
    }
    const proxy = proxyResolution.status === 'valid' ? proxyResolution.proxy : undefined

    const runtimeJob: FacebookPostTaskJobRequest = {
      ...job,
      profileDirectory: accountProfileDirectory(this.dataDirectory, account.id),
      browser: { ...this.getBrowserSettings() },
      session: { ...this.getSessionSettings() },
      network: { ...this.getNetworkSettings() },
      logging: { ...this.getLoggingSettings() },
      sessionAccount: {
        id: account.id,
        uid: account.uid,
        username: account.username,
        password: account.password,
        cookie: account.cookie,
        twoFactorSecret: account.twoFactorSecret,
        name: account.name
      }
    }
    delete runtimeJob.userAgent
    delete runtimeJob.proxy
    if (account.userAgent) runtimeJob.userAgent = account.userAgent
    if (proxy) runtimeJob.proxy = proxy

    const workerResult = await this.workers.runTask(runtimeJob)
    return this.syncWorkerResult(account, workerResult)
  }

  async releaseAccount(accountId: number): Promise<void> {
    await this.workers.closeAccount(accountId)
    await this.releaseManagedBrowser(accountId)
  }

  retileBrowsers(placements: Map<number, BrowserWindowPlacement>): number {
    return this.workers.retile(placements)
  }

  closeAll(): void {
    this.workers.closeAll()
  }

  private syncWorkerResult(account: AccountRecord, workerResult: PostingJobResult): PostingJobResult {
    const sessionCookie = workerResult.sessionCookie?.trim() || null
    const publicWorkerResult: PostingJobResult = { ...workerResult }
    delete publicWorkerResult.sessionCookie
    const safeMessage = redactExecutionText(publicWorkerResult.message, accountSecrets(account)) ?? 'Lỗi không xác định'
    const safeValidation = publicWorkerResult.sessionValidation
      ? {
          ...publicWorkerResult.sessionValidation,
          message: redactExecutionText(publicWorkerResult.sessionValidation.message, accountSecrets(account)) ?? 'Kiểm tra phiên đăng nhập thất bại.'
        }
      : undefined
    const result: PostingJobResult = {
      ...publicWorkerResult,
      message: safeMessage,
      ...(safeValidation ? { sessionValidation: safeValidation } : {}),
      ...(publicWorkerResult.accountName?.trim() ? { accountName: publicWorkerResult.accountName.trim() } : {})
    }

    const now = Date.now()
    const syncedName = result.accountName?.trim() || account.name
    if (hasInvalidSession(result)) {
      this.accounts.update(account.id, {
        name: syncedName,
        status: 'needs_login',
        cookieStatus: 'needs_login',
        lastCookieCheck: now,
        lastUsedAt: now
      })
    } else if (hasValidSession(result)) {
      this.accounts.update(account.id, {
        name: syncedName,
        status: 'valid',
        cookie: sessionCookie ?? account.cookie,
        cookieStatus: 'valid',
        lastCookieCheck: now,
        lastUsedAt: now
      })
    } else {
      this.accounts.update(account.id, { name: syncedName, lastUsedAt: now })
    }

    return result
  }
}
