import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { AccountRecord, BrowserProfileResult } from '../../shared/accounts'
import { DEFAULT_APP_SETTINGS, type BrowserSettings, type SessionSettings } from '../../shared/appSettings'
import {
  cloneDefaultBrowserWindowLayout,
  type BrowserWindowLayoutSettings,
  type BrowserWindowPlacement
} from '../../shared/browserWindowLayout'
import type {
  EmailCodeResult,
  EmailCodeWorkerRequestMessage,
  EmailCodeWorkerResponseMessage
} from '../../shared/emailCode'
import type {
  FacebookCheckpoint282RunPayload,
  FacebookCheckpoint282Result,
  FacebookCheckpointSurface
} from '../../shared/facebookCheckpoint'
import { getEmailCodeProvider } from '../services/emailCodeProviderRegistry'
import { setBrowserLaunchAwareTimeout } from './browserLaunchBroker'
import type { FacebookSessionAccount, FacebookSessionResult } from './facebookSession'
import {
  FacebookProfileResolutionError,
  appManagedFacebookProfileDirectory,
  resolveFacebookProfileDirectory
} from './facebookProfileResolver'
import { BrowserWindowLayoutManager } from './browserWindowLayoutManager'
import {
  consumeCheckpoint282StaleResult,
  markCheckpoint282ResultStale
} from './checkpoint282ResultGuard'
import {
  clearAllManagedBrowserEndpoints,
  clearManagedBrowserEndpoint,
  setManagedBrowserEndpoint
} from './managedBrowserRegistry'
import { resolveAccountProxyState } from './proxyConfig'

const PROFILE_SHUTDOWN_TIMEOUT_MS = 5_000

interface BrowserReadyMessage {
  type: 'browser-ready'
  accountId: number
  cdpEndpoint: string
}

interface SessionResultMessage extends FacebookSessionResult {
  type: 'session-result'
  cdpEndpoint?: string
}

interface Checkpoint282ResultMessage extends FacebookCheckpoint282Result {
  type: 'checkpoint-282-result'
}

interface Checkpoint956ResultMessage extends FacebookCheckpoint282Result {
  type: 'checkpoint-956-result'
}

interface BrowserClosedMessage {
  type: 'browser-closed'
}

interface PendingBootstrap {
  resolve: (result: BrowserProfileResult) => void
  timer: NodeJS.Timeout
  openStatus: 'started' | 'already_open'
}

interface PendingCheckpoint {
  resolve: (result: FacebookCheckpoint282Result) => void
  timer: NodeJS.Timeout
  uid: string
  surface: FacebookCheckpointSurface
}

interface BrowserWorkerEntry {
  process: UtilityProcess
  profileDirectory: string
  pending: PendingBootstrap | null
  checkpoint282Pending: PendingCheckpoint | null
  checkpoint956Pending: PendingCheckpoint | null
  checkpoint282StaleResultCount: number
  closing: boolean
  closePromise: Promise<void> | null
}

type SessionResultHandler = (result: FacebookSessionResult) => void
type AccountClosedListener = (accountId: number) => void

/** @deprecated App-managed path only. New Facebook flows must use resolveFacebookProfileDirectory. */
export function accountProfileDirectory(dataDirectory: string, accountId: number): string {
  return appManagedFacebookProfileDirectory(dataDirectory, accountId)
}

function sessionAccount(account: AccountRecord): FacebookSessionAccount {
  return {
    id: account.id,
    uid: account.uid,
    username: account.username,
    password: account.password,
    cookie: account.cookie,
    twoFactorSecret: account.twoFactorSecret
  }
}

function emailSupportError(accountId: number, message: string): EmailCodeResult {
  return {
    accountId,
    status: 'email_support_error',
    code: null,
    receivedAt: null,
    sender: null,
    message
  }
}

function profileErrorResult(error: unknown): BrowserProfileResult {
  return {
    status: 'error',
    ...(error instanceof FacebookProfileResolutionError ? { code: error.code } : {}),
    message: error instanceof Error ? error.message : String(error)
  }
}

function isBrowserReadyMessage(message: unknown): message is BrowserReadyMessage {
  if (!message || typeof message !== 'object') return false
  const candidate = message as Partial<BrowserReadyMessage>
  return candidate.type === 'browser-ready'
    && typeof candidate.accountId === 'number'
    && typeof candidate.cdpEndpoint === 'string'
    && candidate.cdpEndpoint.length > 0
}

function isSessionResultMessage(message: unknown): message is SessionResultMessage {
  if (!message || typeof message !== 'object') return false
  const candidate = message as Partial<SessionResultMessage>
  return candidate.type === 'session-result'
    && typeof candidate.accountId === 'number'
    && typeof candidate.message === 'string'
}

function isCheckpoint282ResultMessage(message: unknown): message is Checkpoint282ResultMessage {
  if (!message || typeof message !== 'object') return false
  const candidate = message as Partial<Checkpoint282ResultMessage>
  return candidate.type === 'checkpoint-282-result'
    && typeof candidate.accountId === 'number'
    && typeof candidate.uid === 'string'
    && typeof candidate.state === 'string'
    && typeof candidate.surface === 'string'
    && typeof candidate.message === 'string'
}

function isCheckpoint956ResultMessage(message: unknown): message is Checkpoint956ResultMessage {
  if (!message || typeof message !== 'object') return false
  const candidate = message as Partial<Checkpoint956ResultMessage>
  return candidate.type === 'checkpoint-956-result'
    && typeof candidate.accountId === 'number'
    && typeof candidate.uid === 'string'
    && typeof candidate.state === 'string'
    && typeof candidate.surface === 'string'
    && typeof candidate.message === 'string'
}

function isBrowserClosedMessage(message: unknown): message is BrowserClosedMessage {
  return Boolean(message && typeof message === 'object' && (message as Partial<BrowserClosedMessage>).type === 'browser-closed')
}

function isEmailCodeRequestMessage(message: unknown): message is EmailCodeWorkerRequestMessage {
  return Boolean(message && typeof message === 'object' && (message as { type?: unknown }).type === 'email_code_request')
}

export class BrowserProfileManager {
  private readonly workers = new Map<number, BrowserWorkerEntry>()
  private readonly accountClosedListeners = new Set<AccountClosedListener>()

  constructor(
    private readonly dataDirectory: string,
    private readonly onSessionResult?: SessionResultHandler,
    private readonly getBrowserSettings: () => BrowserSettings = () => ({ ...DEFAULT_APP_SETTINGS.browser }),
    private readonly getSessionSettings: () => SessionSettings = () => ({ ...DEFAULT_APP_SETTINGS.session }),
    private readonly windowLayout?: BrowserWindowLayoutManager,
    private readonly getWindowLayoutSettings: () => BrowserWindowLayoutSettings = () => cloneDefaultBrowserWindowLayout()
  ) {}

  onAccountClosed(listener: AccountClosedListener): () => void {
    this.accountClosedListeners.add(listener)
    return () => this.accountClosedListeners.delete(listener)
  }

  async open(account: AccountRecord): Promise<BrowserProfileResult> {
    let profileDirectory: string
    try {
      profileDirectory = resolveFacebookProfileDirectory(this.dataDirectory, account, this.getBrowserSettings()).profileDirectory
    } catch (error) {
      return profileErrorResult(error)
    }

    const proxyResolution = resolveAccountProxyState(account)
    if (proxyResolution.status === 'invalid') {
      return { status: 'error', profileDirectory, message: proxyResolution.message }
    }

    let existing = this.workers.get(account.id)
    if (existing && !existing.closing && existing.profileDirectory !== profileDirectory) {
      if (existing.pending || existing.checkpoint282Pending || existing.checkpoint956Pending) {
        return {
          status: 'error',
          profileDirectory,
          message: 'Facebook Profile Root vừa thay đổi nhưng browser account đang bận. Hãy dừng lượt hiện tại rồi mở lại account.'
        }
      }
      await this.closeAccount(account.id)
      existing = undefined
    }
    if (existing && !existing.closing) {
      if (existing.pending || existing.checkpoint282Pending || existing.checkpoint956Pending) {
        return {
          status: 'already_open',
          profileDirectory,
          message: 'Browser profile đang mở và Facebook Common đang xử lý account.'
        }
      }
      return this.bootstrap(existing, account, 'already_open')
    }
    if (existing) this.workers.delete(account.id)

    try {
      const entry = await this.spawnWorker(account, profileDirectory)
      return await this.bootstrap(entry, account, 'started')
    } catch (error) {
      this.workers.delete(account.id)
      clearManagedBrowserEndpoint(account.id)
      this.windowLayout?.release(account.id, 'profile')
      return {
        status: 'error',
        profileDirectory,
        ...(error instanceof FacebookProfileResolutionError ? { code: error.code } : {}),
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async runCheckpoint282(
    account: AccountRecord,
    payload: Omit<FacebookCheckpoint282RunPayload, 'accountId'>
  ): Promise<FacebookCheckpoint282Result> {
    const existing = this.workers.get(account.id)
    if (existing?.pending || existing?.checkpoint956Pending) {
      return {
        accountId: account.id,
        uid: account.uid,
        state: 'error',
        surface: payload.surface,
        message: 'Browser account đang khởi động hoặc Common Challenge đang xử lý; chờ hoàn tất rồi chạy CP282 lại.'
      }
    }

    const opened = await this.open(account)
    if (opened.status === 'error') {
      return {
        accountId: account.id,
        uid: account.uid,
        state: 'error',
        surface: payload.surface,
        message: opened.message ?? 'Không thể mở browser account để kiểm tra CP282.'
      }
    }

    const entry = this.workers.get(account.id)
    if (!entry || entry.closing) {
      return {
        accountId: account.id,
        uid: account.uid,
        state: 'error',
        surface: payload.surface,
        message: 'Browser account đã đóng trước khi bắt đầu kiểm tra CP282.'
      }
    }
    if (entry.checkpoint282Pending) {
      return {
        accountId: account.id,
        uid: account.uid,
        state: 'error',
        surface: payload.surface,
        message: 'Account đang có một lượt kiểm tra CP282 khác.'
      }
    }

    const browserSettings = { ...this.getBrowserSettings() }
    return new Promise<FacebookCheckpoint282Result>((resolve) => {
      const timeoutMs = Math.max(15_000, browserSettings.navigationTimeoutMs + 15_000)
      const timer = setTimeout(() => {
        if (!entry.checkpoint282Pending || entry.checkpoint282Pending.resolve !== resolve) return
        entry.checkpoint282Pending = null
        entry.checkpoint282StaleResultCount = markCheckpoint282ResultStale(entry.checkpoint282StaleResultCount)
        resolve({
          accountId: account.id,
          uid: account.uid,
          state: 'error',
          surface: payload.surface,
          message: 'Quá thời gian kiểm tra CP282; browser vẫn được giữ mở.'
        })
      }, timeoutMs)
      entry.checkpoint282Pending = { resolve, timer, uid: account.uid, surface: payload.surface }

      try {
        entry.process.postMessage({
          type: 'checkpoint-282',
          account: sessionAccount(account),
          browser: browserSettings,
          surface: payload.surface,
          action: payload.action,
          sessionWasValid: opened.sessionStatus === 'valid',
          evidenceFolder: payload.evidenceFolder ?? null
        })
      } catch (error) {
        clearTimeout(timer)
        entry.checkpoint282Pending = null
        resolve({
          accountId: account.id,
          uid: account.uid,
          state: 'error',
          surface: payload.surface,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    })
  }

  async runCheckpoint956(
    account: AccountRecord,
    payload: Pick<FacebookCheckpoint282RunPayload, 'surface' | 'action' | 'evidenceFolder'>
  ): Promise<FacebookCheckpoint282Result> {
    let profileDirectory: string
    try {
      profileDirectory = resolveFacebookProfileDirectory(this.dataDirectory, account, this.getBrowserSettings()).profileDirectory
    } catch (error) {
      return {
        accountId: account.id,
        uid: account.uid,
        state: 'error',
        surface: payload.surface,
        checkpointKind: '956',
        message: error instanceof Error ? error.message : String(error)
      }
    }

    const proxyResolution = resolveAccountProxyState(account)
    if (proxyResolution.status === 'invalid') {
      return {
        accountId: account.id,
        uid: account.uid,
        state: 'error',
        surface: payload.surface,
        checkpointKind: '956',
        message: proxyResolution.message
      }
    }

    let entry = this.workers.get(account.id)
    if (entry && !entry.closing && entry.profileDirectory !== profileDirectory) {
      if (entry.pending || entry.checkpoint282Pending || entry.checkpoint956Pending) {
        return {
          accountId: account.id,
          uid: account.uid,
          state: 'error',
          surface: payload.surface,
          checkpointKind: '956',
          message: 'Facebook Profile Root vừa thay đổi nhưng browser account đang bận. Hãy Stop flow cũ trước khi chạy CP956 lại.'
        }
      }
      await this.closeAccount(account.id)
      entry = undefined
    }
    if (entry && !entry.closing && (entry.pending || entry.checkpoint282Pending || entry.checkpoint956Pending)) {
      return {
        accountId: account.id,
        uid: account.uid,
        state: 'error',
        surface: payload.surface,
        checkpointKind: '956',
        message: 'Account đang có một lượt Facebook Common khác trong browser profile.'
      }
    }

    if (!entry || entry.closing) {
      if (entry) this.workers.delete(account.id)
      try {
        entry = await this.spawnWorker(account, profileDirectory)
      } catch (error) {
        return {
          accountId: account.id,
          uid: account.uid,
          state: 'error',
          surface: payload.surface,
          checkpointKind: '956',
          message: error instanceof Error ? error.message : String(error)
        }
      }
    }

    const browserSettings = { ...this.getBrowserSettings() }
    const sessionSettings = { ...this.getSessionSettings() }
    const layoutSettings = { ...this.getWindowLayoutSettings() }
    const placement = this.windowLayout?.placementFor(account.id, layoutSettings, browserSettings) ?? null
    const proxy = proxyResolution.status === 'valid' ? proxyResolution.proxy : undefined

    return new Promise<FacebookCheckpoint282Result>((resolve) => {
      const timeoutMs = browserSettings.startupDelayMs
        + browserSettings.startupTimeoutMs
        + browserSettings.navigationTimeoutMs
        + 45_000
      const timer = setBrowserLaunchAwareTimeout(entry.process, () => {
        if (!entry?.checkpoint956Pending || entry.checkpoint956Pending.resolve !== resolve) return
        entry.checkpoint956Pending = null
        resolve({
          accountId: account.id,
          uid: account.uid,
          state: 'error',
          surface: payload.surface,
          checkpointKind: '956',
          message: 'CP956 Common Runtime quá thời gian phản hồi; browser vẫn được giữ mở để watchdog/controller xử lý.'
        })
      }, timeoutMs)
      entry.checkpoint956Pending = { resolve, timer, uid: account.uid, surface: payload.surface }

      try {
        entry.process.postMessage({
          type: 'checkpoint-956',
          account: sessionAccount(account),
          browser: browserSettings,
          session: sessionSettings,
          surface: payload.surface,
          action: payload.action,
          evidenceFolder: payload.evidenceFolder ?? null,
          placement,
          launch: {
            ...(proxy ? { proxy } : {}),
            ...(account.userAgent ? { userAgent: account.userAgent } : {})
          }
        })
      } catch (error) {
        clearTimeout(timer)
        entry.checkpoint956Pending = null
        resolve({
          accountId: account.id,
          uid: account.uid,
          state: 'error',
          surface: payload.surface,
          checkpointKind: '956',
          message: error instanceof Error ? error.message : String(error)
        })
      }
    })
  }

  async closeAccount(accountId: number): Promise<void> {
    const entry = this.workers.get(accountId)
    clearManagedBrowserEndpoint(accountId)
    if (!entry) {
      this.windowLayout?.release(accountId, 'profile')
      return
    }
    if (entry.closePromise) return entry.closePromise

    entry.closing = true
    if (entry.pending) {
      clearTimeout(entry.pending.timer)
      entry.pending.resolve({
        status: 'error',
        profileDirectory: entry.profileDirectory,
        message: 'Browser đang được đóng vì lượt automation của account đã kết thúc.'
      })
      entry.pending = null
    }
    if (entry.checkpoint282Pending) {
      clearTimeout(entry.checkpoint282Pending.timer)
      entry.checkpoint282Pending.resolve({
        accountId,
        uid: entry.checkpoint282Pending.uid,
        state: 'error',
        surface: entry.checkpoint282Pending.surface,
        message: 'Browser đang được đóng khi flow CP282 chưa hoàn tất.'
      })
      entry.checkpoint282Pending = null
    }
    if (entry.checkpoint956Pending) {
      clearTimeout(entry.checkpoint956Pending.timer)
      entry.checkpoint956Pending.resolve({
        accountId,
        uid: entry.checkpoint956Pending.uid,
        state: 'error',
        surface: entry.checkpoint956Pending.surface,
        checkpointKind: '956',
        message: 'Browser đang được đóng khi CP956 Common Runtime chưa hoàn tất.'
      })
      entry.checkpoint956Pending = null
    }

    entry.closePromise = new Promise<void>((resolve) => {
      let settled = false
      let forceTimer: NodeJS.Timeout | null = null
      let killSettleTimer: NodeJS.Timeout | null = null

      const finish = (): void => {
        if (settled) return
        settled = true
        if (forceTimer) clearTimeout(forceTimer)
        if (killSettleTimer) clearTimeout(killSettleTimer)
        if (this.workers.get(accountId) === entry) this.workers.delete(accountId)
        clearManagedBrowserEndpoint(accountId)
        this.windowLayout?.release(accountId, 'profile')
        resolve()
      }

      entry.process.once('exit', finish)
      forceTimer = setTimeout(() => {
        try {
          entry.process.kill()
        } finally {
          killSettleTimer = setTimeout(finish, 250)
        }
      }, PROFILE_SHUTDOWN_TIMEOUT_MS)

      try {
        entry.process.postMessage({ type: 'shutdown' })
      } catch {
        try {
          entry.process.kill()
        } finally {
          killSettleTimer = setTimeout(finish, 250)
        }
      }
    })

    await entry.closePromise
  }

  retile(placements: Map<number, BrowserWindowPlacement>): number {
    let applied = 0
    for (const [accountId, entry] of this.workers) {
      if (entry.closing) continue
      const placement = placements.get(accountId)
      if (!placement) continue
      try {
        entry.process.postMessage({ type: 'retile', placement })
        applied += 1
      } catch {
        // Worker exit handler will clean the registry if it is already gone.
      }
    }
    return applied
  }

  closeAll(): void {
    for (const [accountId, entry] of this.workers) {
      entry.closing = true
      entry.process.kill()
      this.windowLayout?.release(accountId, 'profile')
    }
    this.workers.clear()
    clearAllManagedBrowserEndpoints()
  }

  private async spawnWorker(account: AccountRecord, profileDirectory: string): Promise<BrowserWorkerEntry> {
    clearManagedBrowserEndpoint(account.id)
    this.windowLayout?.claim(account.id, 'profile')

    const workerPath = join(__dirname, 'browser-profile-worker.js')
    const worker = utilityProcess.fork(workerPath, [profileDirectory], {
      serviceName: `PAGE-AUTO account ${account.id}`
    })
    const entry: BrowserWorkerEntry = {
      process: worker,
      profileDirectory,
      pending: null,
      checkpoint282Pending: null,
      checkpoint956Pending: null,
      checkpoint282StaleResultCount: 0,
      closing: false,
      closePromise: null
    }
    this.workers.set(account.id, entry)

    worker.on('message', (message) => this.handleMessage(account.id, entry, message))
    worker.once('exit', (code) => {
      entry.closing = true
      clearManagedBrowserEndpoint(account.id)
      this.windowLayout?.release(account.id, 'profile')
      if (entry.pending) {
        clearTimeout(entry.pending.timer)
        entry.pending.resolve({
          status: 'error',
          profileDirectory,
          message: `Browser worker đã thoát trước khi kiểm tra session (code ${code}).`
        })
        entry.pending = null
      }
      if (entry.checkpoint282Pending) {
        clearTimeout(entry.checkpoint282Pending.timer)
        entry.checkpoint282Pending.resolve({
          accountId: account.id,
          uid: entry.checkpoint282Pending.uid,
          state: 'error',
          surface: entry.checkpoint282Pending.surface,
          message: `Browser worker đã thoát khi đang kiểm tra CP282 (code ${code}).`
        })
        entry.checkpoint282Pending = null
      }
      if (entry.checkpoint956Pending) {
        clearTimeout(entry.checkpoint956Pending.timer)
        entry.checkpoint956Pending.resolve({
          accountId: account.id,
          uid: entry.checkpoint956Pending.uid,
          state: 'error',
          surface: entry.checkpoint956Pending.surface,
          checkpointKind: '956',
          message: `Browser worker đã thoát khi đang xử lý CP956 (code ${code}).`
        })
        entry.checkpoint956Pending = null
      }
      if (this.workers.get(account.id) === entry) this.workers.delete(account.id)
      this.notifyAccountClosed(account.id)
    })

    await new Promise<void>((resolve) => worker.once('spawn', () => resolve()))
    return entry
  }

  private bootstrap(
    entry: BrowserWorkerEntry,
    account: AccountRecord,
    openStatus: 'started' | 'already_open'
  ): Promise<BrowserProfileResult> {
    const profileDirectory = entry.profileDirectory
    const proxyResolution = resolveAccountProxyState(account)
    if (proxyResolution.status === 'invalid') {
      return Promise.resolve<BrowserProfileResult>({ status: 'error', profileDirectory, message: proxyResolution.message })
    }

    const browserSettings = { ...this.getBrowserSettings() }
    const layoutSettings = { ...this.getWindowLayoutSettings() }
    const placement = this.windowLayout?.placementFor(account.id, layoutSettings, browserSettings) ?? null
    const sessionSettings = { ...this.getSessionSettings() }
    return new Promise<BrowserProfileResult>((resolve) => {
      const responseTimeout = browserSettings.startupDelayMs
        + browserSettings.startupTimeoutMs
        + browserSettings.navigationTimeoutMs
        + 30_000
      const timer = setBrowserLaunchAwareTimeout(entry.process, () => {
        if (!entry.pending || entry.pending.resolve !== resolve) return
        entry.pending = null
        resolve({
          status: 'error',
          profileDirectory,
          message: 'Session Engine quá thời gian chờ phản hồi; browser vẫn được giữ mở.'
        })
      }, responseTimeout)
      entry.pending = { resolve, timer, openStatus }

      try {
        const proxy = proxyResolution.status === 'valid' ? proxyResolution.proxy : undefined
        entry.process.postMessage({
          type: 'bootstrap',
          account: sessionAccount(account),
          browser: browserSettings,
          session: sessionSettings,
          placement,
          launch: {
            ...(proxy ? { proxy } : {}),
            ...(account.userAgent ? { userAgent: account.userAgent } : {})
          }
        })
      } catch (error) {
        clearTimeout(timer)
        entry.pending = null
        resolve({
          status: 'error',
          profileDirectory,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    })
  }

  private async handleEmailCodeRequest(entry: BrowserWorkerEntry, message: EmailCodeWorkerRequestMessage): Promise<void> {
    let result: EmailCodeResult
    if (entry.closing) {
      result = emailSupportError(message.request.accountId, 'Browser profile worker đang đóng; không thể lấy mã Email.')
    } else {
      const provider = getEmailCodeProvider()
      if (!provider) {
        result = emailSupportError(message.request.accountId, 'Email Support Service chưa được khởi tạo ở Main process.')
      } else {
        try {
          result = await provider.getEmailCode(message.request)
        } catch {
          result = emailSupportError(message.request.accountId, 'Email Support Service gặp lỗi khi xử lý CP956.')
        }
      }
    }

    const response: EmailCodeWorkerResponseMessage = {
      type: 'email_code_response',
      requestId: message.requestId,
      result
    }
    try {
      entry.process.postMessage(response)
    } catch {
      // Worker exit path owns cleanup. Never log OTP contents here.
    }
  }

  private handleMessage(accountId: number, entry: BrowserWorkerEntry, message: unknown): void {
    if (isEmailCodeRequestMessage(message)) {
      if (message.request.accountId === accountId) {
        void this.handleEmailCodeRequest(entry, message)
      } else {
        const response: EmailCodeWorkerResponseMessage = {
          type: 'email_code_response',
          requestId: message.requestId,
          result: emailSupportError(accountId, 'Email Support bridge từ chối yêu cầu sai account.')
        }
        try { entry.process.postMessage(response) } catch { /* worker exit owns cleanup */ }
      }
      return
    }

    if (isBrowserClosedMessage(message)) {
      entry.closing = true
      clearManagedBrowserEndpoint(accountId)
      this.windowLayout?.release(accountId, 'profile')
      const pending = entry.pending
      if (pending) {
        clearTimeout(pending.timer)
        entry.pending = null
        pending.resolve({
          status: 'error',
          profileDirectory: entry.profileDirectory,
          message: 'Browser đã được đóng trước khi Session Engine hoàn tất.'
        })
      }
      const checkpointPending = entry.checkpoint282Pending
      if (checkpointPending) {
        clearTimeout(checkpointPending.timer)
        entry.checkpoint282Pending = null
        checkpointPending.resolve({
          accountId,
          uid: checkpointPending.uid,
          state: 'error',
          surface: checkpointPending.surface,
          message: 'Browser đã được đóng trước khi kiểm tra CP282 hoàn tất.'
        })
      }
      const checkpoint956Pending = entry.checkpoint956Pending
      if (checkpoint956Pending) {
        clearTimeout(checkpoint956Pending.timer)
        entry.checkpoint956Pending = null
        checkpoint956Pending.resolve({
          accountId,
          uid: checkpoint956Pending.uid,
          state: 'error',
          surface: checkpoint956Pending.surface,
          checkpointKind: '956',
          message: 'Browser đã được đóng trước khi CP956 Common Runtime hoàn tất.'
        })
      }
      if (this.workers.get(accountId) === entry) this.workers.delete(accountId)
      this.notifyAccountClosed(accountId)
      return
    }

    if (isBrowserReadyMessage(message)) {
      if (message.accountId === accountId) setManagedBrowserEndpoint(accountId, message.cdpEndpoint, entry.profileDirectory)
      return
    }

    if (isCheckpoint282ResultMessage(message) && message.accountId === accountId) {
      const staleDecision = consumeCheckpoint282StaleResult(entry.checkpoint282StaleResultCount)
      entry.checkpoint282StaleResultCount = staleDecision.remaining
      if (staleDecision.ignore) return

      const pending = entry.checkpoint282Pending
      if (!pending) return
      clearTimeout(pending.timer)
      entry.checkpoint282Pending = null
      pending.resolve({
        accountId: message.accountId,
        uid: message.uid,
        state: message.state,
        surface: message.surface,
        message: message.message,
        ...(message.checkpointKind ? { checkpointKind: message.checkpointKind } : {}),
        ...(message.challengeType ? { challengeType: message.challengeType } : {}),
        ...(message.evidencePath ? { evidencePath: message.evidencePath } : {})
      })
      return
    }

    if (isCheckpoint956ResultMessage(message) && message.accountId === accountId) {
      const pending = entry.checkpoint956Pending
      if (!pending) return
      clearTimeout(pending.timer)
      entry.checkpoint956Pending = null
      pending.resolve({
        accountId: message.accountId,
        uid: message.uid,
        state: message.state,
        surface: message.surface,
        message: message.message,
        checkpointKind: message.checkpointKind ?? '956',
        ...(message.challengeType ? { challengeType: message.challengeType } : {}),
        ...(message.evidencePath ? { evidencePath: message.evidencePath } : {})
      })
      return
    }

    if (!isSessionResultMessage(message) || message.accountId !== accountId) return
    if (message.cdpEndpoint) setManagedBrowserEndpoint(accountId, message.cdpEndpoint, entry.profileDirectory)
    this.onSessionResult?.(message)

    const pending = entry.pending
    if (!pending) return
    clearTimeout(pending.timer)
    entry.pending = null
    pending.resolve({
      status: pending.openStatus,
      profileDirectory: entry.profileDirectory,
      sessionStatus: message.status,
      message: message.message
    })
  }

  private notifyAccountClosed(accountId: number): void {
    for (const listener of this.accountClosedListeners) listener(accountId)
  }
}
