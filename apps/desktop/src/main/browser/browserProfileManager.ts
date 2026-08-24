import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { AccountRecord, BrowserProfileResult } from '../../shared/accounts'
import { DEFAULT_APP_SETTINGS, type BrowserSettings, type SessionSettings } from '../../shared/appSettings'
import type { FacebookSessionAccount, FacebookSessionResult } from './facebookSession'
import {
  clearAllManagedBrowserEndpoints,
  clearManagedBrowserEndpoint,
  setManagedBrowserEndpoint
} from './managedBrowserRegistry'
import { resolveAccountProxyState } from './proxyConfig'

interface SessionResultMessage extends FacebookSessionResult {
  type: 'session-result'
  cdpEndpoint?: string
}

interface BrowserClosedMessage {
  type: 'browser-closed'
}

interface PendingBootstrap {
  resolve: (result: BrowserProfileResult) => void
  timer: NodeJS.Timeout
  openStatus: 'started' | 'already_open'
}

interface BrowserWorkerEntry {
  process: UtilityProcess
  pending: PendingBootstrap | null
  closing: boolean
}

type SessionResultHandler = (result: FacebookSessionResult) => void

export function accountProfileDirectory(dataDirectory: string, accountId: number): string {
  return join(dataDirectory, 'browser-profiles', `account-${accountId}`)
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

function isSessionResultMessage(message: unknown): message is SessionResultMessage {
  if (!message || typeof message !== 'object') return false
  const candidate = message as Partial<SessionResultMessage>
  return candidate.type === 'session-result'
    && typeof candidate.accountId === 'number'
    && typeof candidate.message === 'string'
}

function isBrowserClosedMessage(message: unknown): message is BrowserClosedMessage {
  return Boolean(message && typeof message === 'object' && (message as Partial<BrowserClosedMessage>).type === 'browser-closed')
}

export class BrowserProfileManager {
  private readonly workers = new Map<number, BrowserWorkerEntry>()

  constructor(
    private readonly dataDirectory: string,
    private readonly onSessionResult?: SessionResultHandler,
    private readonly getBrowserSettings: () => BrowserSettings = () => ({ ...DEFAULT_APP_SETTINGS.browser }),
    private readonly getSessionSettings: () => SessionSettings = () => ({ ...DEFAULT_APP_SETTINGS.session })
  ) {}

  async open(account: AccountRecord): Promise<BrowserProfileResult> {
    const profileDirectory = accountProfileDirectory(this.dataDirectory, account.id)
    const proxyResolution = resolveAccountProxyState(account)
    if (proxyResolution.status === 'invalid') {
      return {
        status: 'error',
        profileDirectory,
        message: proxyResolution.message
      }
    }

    const existing = this.workers.get(account.id)
    if (existing && !existing.closing) {
      if (existing.pending) {
        return {
          status: 'already_open',
          profileDirectory,
          message: 'Browser profile đang mở và Session Engine đang kiểm tra account.'
        }
      }
      return this.bootstrap(existing, account, 'already_open')
    }
    if (existing) this.workers.delete(account.id)

    clearManagedBrowserEndpoint(account.id)
    mkdirSync(profileDirectory, { recursive: true })

    try {
      const workerPath = join(__dirname, 'browser-profile-worker.js')
      const worker = utilityProcess.fork(workerPath, [profileDirectory], {
        serviceName: `PAGE-AUTO account ${account.id}`
      })
      const entry: BrowserWorkerEntry = { process: worker, pending: null, closing: false }
      this.workers.set(account.id, entry)

      worker.on('message', (message) => this.handleMessage(account.id, entry, message))
      worker.once('exit', (code) => {
        entry.closing = true
        clearManagedBrowserEndpoint(account.id)
        if (entry.pending) {
          clearTimeout(entry.pending.timer)
          entry.pending.resolve({
            status: 'error',
            profileDirectory,
            message: `Browser worker đã thoát trước khi kiểm tra session (code ${code}).`
          })
          entry.pending = null
        }
        if (this.workers.get(account.id) === entry) this.workers.delete(account.id)
      })

      return await new Promise<BrowserProfileResult>((resolve) => {
        worker.once('spawn', () => {
          void this.bootstrap(entry, account, 'started').then(resolve)
        })
      })
    } catch (error) {
      this.workers.delete(account.id)
      clearManagedBrowserEndpoint(account.id)
      return {
        status: 'error',
        profileDirectory,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  closeAll(): void {
    for (const entry of this.workers.values()) {
      entry.closing = true
      entry.process.kill()
    }
    this.workers.clear()
    clearAllManagedBrowserEndpoints()
  }

  private bootstrap(
    entry: BrowserWorkerEntry,
    account: AccountRecord,
    openStatus: 'started' | 'already_open'
  ): Promise<BrowserProfileResult> {
    const profileDirectory = accountProfileDirectory(this.dataDirectory, account.id)
    const proxyResolution = resolveAccountProxyState(account)
    if (proxyResolution.status === 'invalid') {
      return Promise.resolve<BrowserProfileResult>({
        status: 'error',
        profileDirectory,
        message: proxyResolution.message
      })
    }

    const browserSettings = { ...this.getBrowserSettings() }
    const sessionSettings = { ...this.getSessionSettings() }
    return new Promise<BrowserProfileResult>((resolve) => {
      const responseTimeout = browserSettings.startupDelayMs
        + browserSettings.startupTimeoutMs
        + browserSettings.navigationTimeoutMs
        + 30_000
      const timer = setTimeout(() => {
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

  private handleMessage(accountId: number, entry: BrowserWorkerEntry, message: unknown): void {
    if (isBrowserClosedMessage(message)) {
      entry.closing = true
      clearManagedBrowserEndpoint(accountId)
      const pending = entry.pending
      if (pending) {
        clearTimeout(pending.timer)
        entry.pending = null
        pending.resolve({
          status: 'error',
          profileDirectory: accountProfileDirectory(this.dataDirectory, accountId),
          message: 'Browser đã được đóng trước khi Session Engine hoàn tất.'
        })
      }
      if (this.workers.get(accountId) === entry) this.workers.delete(accountId)
      return
    }

    if (!isSessionResultMessage(message) || message.accountId !== accountId) return
    if (message.cdpEndpoint) setManagedBrowserEndpoint(accountId, message.cdpEndpoint)
    this.onSessionResult?.(message)

    const pending = entry.pending
    if (!pending) return
    clearTimeout(pending.timer)
    entry.pending = null
    pending.resolve({
      status: pending.openStatus,
      profileDirectory: accountProfileDirectory(this.dataDirectory, accountId),
      sessionStatus: message.status,
      message: message.message
    })
  }
}
