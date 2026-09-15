import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { AccountRecord } from '../../shared/accounts'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import type { HotmailBrowserOpenResult } from '../../shared/hotmail'
import { setBrowserLaunchAwareTimeout } from '../browser/browserLaunchBroker'
import { isEmailWindowDetachedMessage } from './emailBrowserLifecycle'
import { ensureEmailProfileDirectory, inspectEmailProfile } from './emailProfileResolver'
import type { EmailProxyCandidate } from './emailProxyPool'

interface WorkerOpenResult {
  type: 'open-primary-mailbox-result'
  accountId: number
  status: 'started' | 'already_open' | 'profile_in_use' | 'error'
  attached: boolean
  proxyManagedExternally: boolean
  message: string
}

interface WorkerEntry {
  process: UtilityProcess
  profileDirectory: string
  pending: ((result: WorkerOpenResult) => void) | null
  timer: ReturnType<typeof setTimeout> | null
  spawned: Promise<void>
  proxyKey: string | null
}

function isWorkerOpenResult(value: unknown): value is WorkerOpenResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorkerOpenResult>
  return candidate.type === 'open-primary-mailbox-result'
    && typeof candidate.accountId === 'number'
    && typeof candidate.message === 'string'
}

function openResult(
  accountId: number,
  status: HotmailBrowserOpenResult['status'],
  profileDirectory: string | null,
  message: string,
  attached = false,
  proxyManagedExternally = false
): HotmailBrowserOpenResult {
  return { accountId, status, profileDirectory, message, attached, proxyManagedExternally }
}

export class PrimaryMailboxBrowserManager {
  private readonly workers = new Map<number, WorkerEntry>()

  constructor(
    private readonly onClosed?: (accountId: number) => void,
    private readonly onDetached?: (accountId: number) => void
  ) {}

  isOpen(accountId: number): boolean {
    return this.workers.has(accountId)
  }

  async open(
    account: AccountRecord,
    profileRoot: string,
    browserExecutable: string,
    proxy: EmailProxyCandidate | null,
    placement: BrowserWindowPlacement | null = null
  ): Promise<HotmailBrowserOpenResult> {
    const mailbox = account.email?.trim()
    if (!mailbox) return openResult(account.id, 'error', null, 'Account chưa có Email chính để mở mailbox.')

    const prepared = await this.prepareWorker(account, profileRoot)
    if ('status' in prepared) {
      return openResult(account.id, prepared.status, prepared.profileDirectory, prepared.message)
    }

    const entry = prepared.entry
    if (entry.pending) {
      return openResult(
        account.id,
        'already_open',
        entry.profileDirectory,
        'Browser mail chính đang xử lý lệnh mở trước đó.'
      )
    }

    if (proxy && entry.proxyKey && entry.proxyKey !== proxy.key) {
      return openResult(
        account.id,
        'error',
        entry.profileDirectory,
        'Browser mail chính đang giữ proxy của phiên hiện tại; không đổi proxy giữa một browser process đang chạy.'
      )
    }
    if (proxy && !entry.proxyKey) entry.proxyKey = proxy.key

    try {
      await entry.spawned
      entry.process.postMessage({ type: 'email-window-placement', accountId: account.id, placement })
    } catch {
      return openResult(account.id, 'error', entry.profileDirectory, 'Primary mailbox browser worker không khởi động được.')
    }

    return await new Promise<HotmailBrowserOpenResult>((resolve) => {
      const timer = setBrowserLaunchAwareTimeout(entry.process, () => {
        if (!entry.pending) return
        entry.pending = null
        entry.timer = null
        resolve(openResult(
          account.id,
          'error',
          entry.profileDirectory,
          'Mở mail chính quá thời gian chờ phản hồi.'
        ))
      }, 90_000)

      entry.timer = timer
      entry.pending = (response) => {
        if (entry.timer) clearTimeout(entry.timer)
        entry.timer = null
        entry.pending = null
        resolve(openResult(
          account.id,
          response.status,
          entry.profileDirectory,
          response.message,
          response.attached,
          response.proxyManagedExternally
        ))
      }

      try {
        entry.process.postMessage({
          type: 'open-primary-mailbox',
          accountId: account.id,
          mailbox,
          profileDirectory: entry.profileDirectory,
          ...(browserExecutable.trim() ? { executablePath: browserExecutable.trim() } : {}),
          ...(proxy ? {
            proxy: {
              server: proxy.server,
              ...(proxy.username ? { username: proxy.username } : {}),
              ...(proxy.password ? { password: proxy.password } : {})
            }
          } : {})
        })
      } catch {
        clearTimeout(timer)
        entry.timer = null
        entry.pending = null
        resolve(openResult(account.id, 'error', entry.profileDirectory, 'Không gửi được lệnh tới primary mailbox browser worker.'))
      }
    })
  }

  async applyPlacement(accountId: number, placement: BrowserWindowPlacement | null): Promise<boolean> {
    const entry = this.workers.get(accountId)
    if (!entry) return false
    try {
      await entry.spawned
      entry.process.postMessage({ type: 'email-window-placement', accountId, placement })
      return true
    } catch {
      return false
    }
  }

  closeAll(): void {
    for (const [accountId, entry] of this.workers) this.stopEntry(accountId, entry)
    this.workers.clear()
  }

  private async prepareWorker(
    account: AccountRecord,
    profileRoot: string
  ): Promise<{ entry: WorkerEntry } | { status: 'missing_profile'; profileDirectory: string | null; message: string }> {
    let inspection = await inspectEmailProfile(profileRoot, account.uid)
    if (inspection.status === 'not_configured') {
      return { status: 'missing_profile', profileDirectory: null, message: 'Chưa cấu hình Email Profile Root.' }
    }
    if (inspection.status === 'missing') {
      try {
        const profileDirectory = await ensureEmailProfileDirectory(profileRoot, account.uid)
        inspection = { status: 'available', profileDirectory, cdpEndpoint: null }
      } catch (error) {
        return {
          status: 'missing_profile',
          profileDirectory: inspection.profileDirectory,
          message: error instanceof Error ? error.message : `Không thể tạo Email profile cho UID ${account.uid}.`
        }
      }
    }
    if (!inspection.profileDirectory) {
      return {
        status: 'missing_profile',
        profileDirectory: null,
        message: `Không resolve được Email profile cho UID ${account.uid}.`
      }
    }

    const existing = this.workers.get(account.id)
    if (existing) return { entry: existing }

    const process = utilityProcess.fork(join(__dirname, 'primary-mailbox-browser-worker.js'), [], {
      serviceName: `PAGE-AUTO primary mailbox ${account.uid}`
    })
    let resolveSpawn: (() => void) | null = null
    let rejectSpawn: ((error: Error) => void) | null = null
    const spawned = new Promise<void>((resolve, reject) => {
      resolveSpawn = resolve
      rejectSpawn = reject
    })
    const entry: WorkerEntry = {
      process,
      profileDirectory: inspection.profileDirectory,
      pending: null,
      timer: null,
      spawned,
      proxyKey: null
    }
    this.workers.set(account.id, entry)

    process.once('spawn', () => resolveSpawn?.())
    process.on('message', (message) => {
      if (isEmailWindowDetachedMessage(message)) {
        if (message.accountId === account.id) this.onDetached?.(account.id)
        return
      }
      if (!isWorkerOpenResult(message) || message.accountId !== account.id) return
      entry.pending?.(message)
    })
    process.once('exit', () => {
      rejectSpawn?.(new Error('Primary mailbox browser worker đã thoát trước khi khởi động.'))
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = null
      const pending = entry.pending
      entry.pending = null
      pending?.({
        type: 'open-primary-mailbox-result',
        accountId: account.id,
        status: 'error',
        attached: false,
        proxyManagedExternally: false,
        message: 'Primary mailbox browser worker đã thoát trước khi phản hồi.'
      })
      if (this.workers.get(account.id) === entry) this.workers.delete(account.id)
      this.onClosed?.(account.id)
    })

    return { entry }
  }

  private stopEntry(accountId: number, entry: WorkerEntry): void {
    if (this.workers.get(accountId) === entry) this.workers.delete(accountId)
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    entry.pending = null
    entry.process.kill()
  }
}
