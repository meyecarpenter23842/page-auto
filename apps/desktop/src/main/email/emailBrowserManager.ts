import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { HotmailBrowserOpenResult } from '../../shared/hotmail'
import type { AccountRecord } from '../../shared/accounts'
import { shouldKeepEmailBrowserWorker } from './emailBrowserLifecycle'
import { inspectEmailProfile } from './emailProfileResolver'
import type { EmailProxyCandidate } from './emailProxyPool'

interface WorkerResult {
  type: 'open-result'
  accountId: number
  status: 'started' | 'already_open' | 'profile_in_use' | 'error'
  attached: boolean
  proxyManagedExternally: boolean
  message: string
}

interface WorkerEntry {
  process: UtilityProcess
  profileDirectory: string
  pending: ((result: HotmailBrowserOpenResult) => void) | null
}

function isWorkerResult(value: unknown): value is WorkerResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorkerResult>
  return candidate.type === 'open-result' && typeof candidate.accountId === 'number' && typeof candidate.message === 'string'
}

export class EmailBrowserManager {
  private readonly workers = new Map<number, WorkerEntry>()

  constructor(private readonly onClosed?: (accountId: number) => void) {}

  async open(
    account: AccountRecord,
    profileRoot: string,
    browserExecutable: string,
    proxy: EmailProxyCandidate | null
  ): Promise<HotmailBrowserOpenResult> {
    const inspection = await inspectEmailProfile(profileRoot, account.uid)
    if (inspection.status === 'not_configured') {
      return this.result(account.id, 'missing_profile', null, 'Chưa cấu hình Email Profile Root.', false, false)
    }
    if (inspection.status === 'missing' || !inspection.profileDirectory) {
      return this.result(
        account.id,
        'missing_profile',
        inspection.profileDirectory,
        `Không tìm thấy profile Email có sẵn cho UID ${account.uid}. Hãy chọn đúng thư mục gốc đang chứa ${account.uid}; PAGE-AUTO không tự tạo hoặc clone profile.`,
        false,
        false
      )
    }

    const profileDirectory = inspection.profileDirectory
    const existing = this.workers.get(account.id)
    if (existing) {
      if (existing.pending) return this.result(account.id, 'already_open', existing.profileDirectory, 'Email browser đang xử lý lệnh mở.', false, false)
      return this.sendOpen(existing, account.id, browserExecutable, proxy)
    }

    const process = utilityProcess.fork(join(__dirname, 'email-browser-worker.js'), [], {
      serviceName: `PAGE-AUTO email ${account.uid}`
    })
    const entry: WorkerEntry = { process, profileDirectory, pending: null }
    this.workers.set(account.id, entry)

    process.on('message', (message) => {
      if (!isWorkerResult(message) || message.accountId !== account.id) return
      const pending = entry.pending
      if (!pending) return
      entry.pending = null
      pending({
        accountId: account.id,
        status: message.status,
        message: message.message,
        profileDirectory: entry.profileDirectory,
        attached: message.attached,
        proxyManagedExternally: message.proxyManagedExternally
      })
      if (!shouldKeepEmailBrowserWorker(message.status)) {
        if (this.workers.get(account.id) === entry) this.workers.delete(account.id)
        process.kill()
      }
    })
    process.once('exit', () => {
      const pending = entry.pending
      entry.pending = null
      if (pending) pending(this.result(account.id, 'error', entry.profileDirectory, 'Email browser worker đã thoát trước khi phản hồi.', false, false))
      if (this.workers.get(account.id) === entry) this.workers.delete(account.id)
      this.onClosed?.(account.id)
    })

    const result = await new Promise<HotmailBrowserOpenResult>((resolve) => {
      let settled = false
      const finish = (next: HotmailBrowserOpenResult): void => {
        if (settled) return
        settled = true
        resolve(next)
      }
      process.once('spawn', () => {
        void this.sendOpen(entry, account.id, browserExecutable, proxy).then(finish)
      })
      process.once('exit', () => finish(this.result(account.id, 'error', entry.profileDirectory, 'Email browser worker đã thoát trước khi khởi động.', false, false)))
    })

    return result
  }

  closeAll(): void {
    for (const entry of this.workers.values()) entry.process.kill()
    this.workers.clear()
  }

  isOpen(accountId: number): boolean {
    return this.workers.has(accountId)
  }

  private sendOpen(
    entry: WorkerEntry,
    accountId: number,
    browserExecutable: string,
    proxy: EmailProxyCandidate | null
  ): Promise<HotmailBrowserOpenResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!entry.pending) return
        entry.pending = null
        resolve(this.result(accountId, 'error', entry.profileDirectory, 'Email browser quá thời gian chờ phản hồi.', false, false))
      }, 45_000)
      entry.pending = (result) => {
        clearTimeout(timer)
        resolve(result)
      }
      try {
        entry.process.postMessage({
          type: 'open-mail',
          accountId,
          profileDirectory: entry.profileDirectory,
          ...(browserExecutable.trim() ? { executablePath: browserExecutable.trim() } : {}),
          ...(proxy ? { proxy: { server: proxy.server, ...(proxy.username ? { username: proxy.username } : {}), ...(proxy.password ? { password: proxy.password } : {}) } } : {})
        })
      } catch (error) {
        clearTimeout(timer)
        entry.pending = null
        resolve(this.result(accountId, 'error', entry.profileDirectory, error instanceof Error ? error.message : String(error), false, false))
      }
    })
  }

  private result(
    accountId: number,
    status: HotmailBrowserOpenResult['status'],
    profileDirectory: string | null,
    message: string,
    attached: boolean,
    proxyManagedExternally: boolean
  ): HotmailBrowserOpenResult {
    return { accountId, status, message, profileDirectory, attached, proxyManagedExternally }
  }
}
