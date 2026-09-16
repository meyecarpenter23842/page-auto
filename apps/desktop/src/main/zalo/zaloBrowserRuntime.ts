import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import { DEFAULT_APP_SETTINGS, type BrowserSettings } from '../../shared/appSettings'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import {
  redactZaloSecretText,
  type ZaloAccountRecord,
  type ZaloBrowserSettings,
  type ZaloLoginMode,
  type ZaloOpenResult,
  type ZaloSessionStatus
} from '../../shared/zalo'
import { setBrowserLaunchAwareTimeout } from '../browser/browserLaunchBroker'
import { BrowserSlotPool } from '../browser/browserSlotPool'
import { BrowserWindowLayoutManager } from '../browser/browserWindowLayoutManager'
import { ZaloAccountRepository } from '../database/zaloRepository'
import { ZaloExecutionCoordinator, type ZaloAccountLease } from './zaloExecutionCoordinator'
import { resolveZaloProfileDirectory, ZaloProfileResolutionError } from './zaloProfileResolver'

const OPEN_TIMEOUT_MS = 90_000
const LOGIN_TIMEOUT_MS = 190_000
const SHUTDOWN_TIMEOUT_MS = 5_000

type PendingRequest = {
  resolve: (result: ZaloOpenResult) => void
  timer: NodeJS.Timeout
  secrets: Array<string | null | undefined>
}
type WorkerEntry = {
  process: UtilityProcess
  profileDirectory: string
  lease: ZaloAccountLease
  pending: PendingRequest | null
  closing: boolean
}

type WorkerResultMessage = {
  type: 'zalo-result'
  accountId: number
  status: ZaloSessionStatus
  message: string
  reused: boolean
}

type WorkerClosedMessage = { type: 'zalo-closed'; accountId: number }

function isResult(message: unknown): message is WorkerResultMessage {
  if (!message || typeof message !== 'object') return false
  const candidate = message as Partial<WorkerResultMessage>
  return candidate.type === 'zalo-result' && typeof candidate.accountId === 'number' && typeof candidate.status === 'string'
}

function isClosed(message: unknown): message is WorkerClosedMessage {
  if (!message || typeof message !== 'object') return false
  const candidate = message as Partial<WorkerClosedMessage>
  return candidate.type === 'zalo-closed' && typeof candidate.accountId === 'number'
}

function asBrowserSettings(settings: ZaloBrowserSettings): BrowserSettings {
  return {
    ...DEFAULT_APP_SETTINGS.browser,
    executablePath: settings.executablePath,
    windowWidth: settings.windowWidth,
    windowHeight: settings.windowHeight
  }
}

export class ZaloBrowserRuntime {
  private readonly workers = new Map<number, WorkerEntry>()
  private readonly coordinator = new ZaloExecutionCoordinator()
  private readonly windowLayout = new BrowserWindowLayoutManager(new BrowserSlotPool())

  constructor(
    private readonly dataDirectory: string,
    private readonly accounts: ZaloAccountRepository,
    private readonly getSettings: () => ZaloBrowserSettings
  ) {}

  async open(account: ZaloAccountRecord): Promise<ZaloOpenResult> {
    const settings = this.getSettings()
    let resolved
    try {
      resolved = resolveZaloProfileDirectory(this.dataDirectory, account, settings)
    } catch (error) {
      const status: ZaloSessionStatus = 'profile_error'
      this.accounts.updateSessionStatus(account.id, status)
      return {
        accountId: account.id,
        profileDirectory: null,
        status,
        reused: false,
        message: error instanceof ZaloProfileResolutionError ? error.message : 'Không thể chuẩn bị Zalo profile.'
      }
    }

    let entry = this.workers.get(account.id)
    if (entry && !entry.closing && entry.profileDirectory !== resolved.profileDirectory) {
      await this.close(account.id)
      entry = undefined
    }

    let reused = Boolean(entry && !entry.closing)
    if (!entry || entry.closing) {
      if (entry) this.workers.delete(account.id)
      const lease = this.coordinator.tryAcquire(account.id)
      if (!lease) {
        return {
          accountId: account.id,
          profileDirectory: resolved.profileDirectory,
          status: 'needs_attention',
          reused: false,
          message: 'Zalo account đang được một operation khác điều khiển.'
        }
      }
      try {
        entry = await this.spawn(account.id, resolved.profileDirectory, lease)
        reused = false
      } catch (error) {
        lease.release()
        this.accounts.updateSessionStatus(account.id, 'browser_error')
        return {
          accountId: account.id,
          profileDirectory: resolved.profileDirectory,
          status: 'browser_error',
          reused: false,
          message: error instanceof Error ? error.message : String(error)
        }
      }
    }

    const placement = this.placement(account.id, settings)
    try {
      entry.process.postMessage({ type: 'apply-settings', settings, placement })
    } catch {
      // open command below will surface worker failure.
    }

    return this.request(
      account.id,
      entry,
      reused,
      OPEN_TIMEOUT_MS,
      { type: 'open', accountId: account.id, settings, placement },
      'Zalo browser quá thời gian chờ session evidence.'
    )
  }

  async login(account: ZaloAccountRecord, mode: ZaloLoginMode): Promise<ZaloOpenResult> {
    const opened = await this.open(account)
    if (opened.status === 'ready' || opened.status === 'profile_error' || opened.status === 'browser_error' || opened.status === 'needs_attention') {
      return opened
    }
    if (mode === 'phone_password' && !account.password) {
      this.accounts.updateSessionStatus(account.id, 'login_required')
      return {
        ...opened,
        status: 'login_required',
        message: 'Tài khoản Zalo chưa có mật khẩu để đăng nhập tự động.'
      }
    }

    const entry = this.workers.get(account.id)
    if (!entry || entry.closing) {
      this.accounts.updateSessionStatus(account.id, 'browser_error')
      return {
        ...opened,
        status: 'browser_error',
        message: 'Zalo browser không còn khả dụng để tiếp tục đăng nhập.'
      }
    }

    return this.request(
      account.id,
      entry,
      true,
      LOGIN_TIMEOUT_MS,
      {
        type: 'login',
        accountId: account.id,
        mode,
        phone: account.phone,
        password: mode === 'phone_password' ? account.password : null
      },
      mode === 'qr'
        ? 'Hết thời gian chờ operator xác nhận QR Zalo.'
        : 'Zalo quá thời gian chờ xác thực sau đăng nhập.',
      [account.password]
    )
  }

  applySettingsToOpenBrowsers(settings: ZaloBrowserSettings): void {
    for (const [accountId, entry] of this.workers) {
      if (entry.closing) continue
      const placement = this.placement(accountId, settings)
      try { entry.process.postMessage({ type: 'apply-settings', settings, placement }) } catch { /* exit cleanup owns state */ }
    }
  }

  async close(accountId: number): Promise<void> {
    const entry = this.workers.get(accountId)
    if (!entry) {
      this.windowLayout.release(accountId, 'profile')
      return
    }
    entry.closing = true
    this.resolvePending(accountId, entry, 'browser_error', 'Zalo browser đã đóng trước khi kiểm tra session xong.', true)
    await new Promise<void>((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        this.cleanup(accountId, entry)
        resolve()
      }
      entry.process.once('exit', finish)
      const timer = setTimeout(() => {
        try { entry.process.kill() } finally { finish() }
      }, SHUTDOWN_TIMEOUT_MS)
      timer.unref?.()
      try { entry.process.postMessage({ type: 'shutdown' }) } catch { entry.process.kill(); finish() }
    })
  }

  closeAll(): void {
    for (const [accountId, entry] of this.workers) {
      entry.closing = true
      this.resolvePending(accountId, entry, 'browser_error', 'Zalo browser runtime đang đóng.', true)
      try { entry.process.kill() } catch { /* already gone */ }
      this.cleanup(accountId, entry)
    }
    this.workers.clear()
    this.coordinator.clear()
  }

  isControlled(accountId: number): boolean {
    return this.coordinator.isActive(accountId)
  }

  private request(
    accountId: number,
    entry: WorkerEntry,
    reused: boolean,
    timeoutMs: number,
    command: unknown,
    timeoutMessage: string,
    secrets: Array<string | null | undefined> = []
  ): Promise<ZaloOpenResult> {
    return new Promise<ZaloOpenResult>((resolve) => {
      if (entry.pending) {
        resolve({ accountId, profileDirectory: entry.profileDirectory, status: 'needs_attention', reused: true, message: 'Zalo account đang mở/kiểm tra session.' })
        return
      }
      const timer = setBrowserLaunchAwareTimeout(entry.process, () => {
        if (!entry.pending || entry.pending.resolve !== resolve) return
        entry.pending = null
        resolve({ accountId, profileDirectory: entry.profileDirectory, status: 'browser_error', reused, message: timeoutMessage })
      }, timeoutMs)
      entry.pending = { resolve, timer, secrets }
      try {
        entry.process.postMessage(command)
      } catch (error) {
        clearTimeout(timer)
        entry.pending = null
        const message = redactZaloSecretText(error instanceof Error ? error.message : String(error), secrets)
        resolve({ accountId, profileDirectory: entry.profileDirectory, status: 'browser_error', reused, message })
      }
    })
  }

  private placement(accountId: number, settings: ZaloBrowserSettings): BrowserWindowPlacement | null {
    this.windowLayout.claim(accountId, 'profile')
    return this.windowLayout.placementFor(accountId, settings.layout, asBrowserSettings(settings))
  }

  private async spawn(accountId: number, profileDirectory: string, lease: ZaloAccountLease): Promise<WorkerEntry> {
    this.windowLayout.claim(accountId, 'profile')
    const worker = utilityProcess.fork(join(__dirname, 'zalo-browser-worker.js'), [profileDirectory, String(accountId)], {
      serviceName: `PAGE-AUTO Zalo ${accountId}`
    })
    const entry: WorkerEntry = { process: worker, profileDirectory, lease, pending: null, closing: false }
    this.workers.set(accountId, entry)
    worker.on('message', (message) => this.handleMessage(accountId, entry, message))
    worker.once('exit', () => {
      if (!entry.closing) {
        this.accounts.updateSessionStatus(accountId, 'browser_error')
        this.resolvePending(accountId, entry, 'browser_error', 'Zalo browser worker đã dừng ngoài dự kiến.', true)
      }
      this.cleanup(accountId, entry)
    })
    await new Promise<void>((resolve) => worker.once('spawn', resolve))
    return entry
  }

  private handleMessage(accountId: number, entry: WorkerEntry, message: unknown): void {
    if (isResult(message) && message.accountId === accountId) {
      this.accounts.markOpened(accountId, message.status)
      const pending = entry.pending
      if (!pending) return
      clearTimeout(pending.timer)
      entry.pending = null
      pending.resolve({
        accountId,
        profileDirectory: entry.profileDirectory,
        status: message.status,
        reused: message.reused,
        message: redactZaloSecretText(message.message, pending.secrets)
      })
      return
    }
    if (isClosed(message) && message.accountId === accountId) this.cleanup(accountId, entry)
  }

  private resolvePending(
    accountId: number,
    entry: WorkerEntry,
    status: ZaloSessionStatus,
    message: string,
    reused: boolean
  ): void {
    const pending = entry.pending
    if (!pending) return
    clearTimeout(pending.timer)
    entry.pending = null
    pending.resolve({
      accountId,
      profileDirectory: entry.profileDirectory,
      status,
      reused,
      message: redactZaloSecretText(message, pending.secrets)
    })
  }

  private cleanup(accountId: number, entry: WorkerEntry): void {
    if (this.workers.get(accountId) === entry) this.workers.delete(accountId)
    this.windowLayout.release(accountId, 'profile')
    entry.lease.release()
  }
}
