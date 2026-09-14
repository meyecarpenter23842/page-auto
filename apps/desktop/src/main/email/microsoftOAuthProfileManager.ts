import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { HotmailNeedsAttentionReason } from '../../shared/hotmail'
import {
  isMailboxProviderWorkerRequestMessage,
  mailboxProviderUnavailableResponse,
  type MailboxProviderWorkerRequestHandler,
  type MailboxProviderWorkerRequestMessage
} from './mailboxProviderWorkerRpc'
import type { EmailProxyCandidate } from './emailProxyPool'

export interface MicrosoftOAuthProfileCommand {
  accountId: number
  profileDirectory: string
  executablePath: string
  authorizationUrl: string
  state: string
  loginEmail?: string
  loginPassword?: string
  backupEmail?: string
  proxy: EmailProxyCandidate | null
}

export interface MicrosoftOAuthProfileResult {
  accountId: number
  status: 'success' | 'needs_attention' | 'profile_in_use' | 'error'
  code?: string
  needsAttentionReason?: HotmailNeedsAttentionReason
  proxyManagedExternally: boolean
  message: string
}

interface WorkerResult extends MicrosoftOAuthProfileResult {
  type: 'oauth-result'
}

interface WorkerEntry {
  process: UtilityProcess
  spawned: Promise<void>
  pending: {
    resolve: (result: MicrosoftOAuthProfileResult) => void
    timer: ReturnType<typeof setTimeout>
  } | null
}

function isWorkerResult(value: unknown): value is WorkerResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorkerResult>
  return candidate.type === 'oauth-result'
    && typeof candidate.accountId === 'number'
    && (candidate.status === 'success' || candidate.status === 'needs_attention' || candidate.status === 'profile_in_use' || candidate.status === 'error')
    && typeof candidate.message === 'string'
}

function proxyPayload(proxy: EmailProxyCandidate | null) {
  return proxy ? {
    proxy: {
      server: proxy.server,
      ...(proxy.username ? { username: proxy.username } : {}),
      ...(proxy.password ? { password: proxy.password } : {})
    }
  } : {}
}

export class MicrosoftOAuthProfileManager {
  private readonly workers = new Map<number, WorkerEntry>()

  constructor(private readonly mailboxProviderRequestHandler?: MailboxProviderWorkerRequestHandler) {}

  isActive(accountId: number): boolean {
    return this.workers.has(accountId)
  }

  activeAccountIds(): number[] {
    return [...this.workers.keys()]
  }

  async authorize(command: MicrosoftOAuthProfileCommand): Promise<MicrosoftOAuthProfileResult> {
    const entry = this.workers.get(command.accountId) ?? this.spawn(command.accountId)
    if (entry.pending) {
      return {
        accountId: command.accountId,
        status: 'error',
        proxyManagedExternally: false,
        message: 'Microsoft OAuth đang chạy cho account này.'
      }
    }

    try {
      await entry.spawned
    } catch {
      this.stop(command.accountId, entry)
      return {
        accountId: command.accountId,
        status: 'error',
        proxyManagedExternally: false,
        message: 'Email OAuth worker không khởi động được.'
      }
    }

    return await new Promise<MicrosoftOAuthProfileResult>((resolve) => {
      const timer = setTimeout(() => {
        if (!entry.pending) return
        entry.pending = null
        resolve({
          accountId: command.accountId,
          status: 'needs_attention',
          needsAttentionReason: 'manual_completion_required',
          proxyManagedExternally: false,
          message: 'Microsoft OAuth vẫn đang chờ thao tác trong Email profile; PAGE-AUTO giữ browser mở.'
        })
      }, 180_000)
      entry.pending = { resolve, timer }
      try {
        entry.process.postMessage({
          type: 'oauth-authorize',
          accountId: command.accountId,
          profileDirectory: command.profileDirectory,
          executablePath: command.executablePath,
          authorizationUrl: command.authorizationUrl,
          state: command.state,
          ...(command.loginEmail ? { loginEmail: command.loginEmail } : {}),
          ...(command.loginPassword ? { loginPassword: command.loginPassword } : {}),
          ...(command.backupEmail ? { backupEmail: command.backupEmail } : {}),
          ...proxyPayload(command.proxy)
        })
      } catch {
        clearTimeout(timer)
        entry.pending = null
        this.stop(command.accountId, entry)
        resolve({
          accountId: command.accountId,
          status: 'error',
          proxyManagedExternally: false,
          message: 'Không gửi được lệnh OAuth tới Email worker.'
        })
      }
    })
  }

  closeAccount(accountId: number): void {
    const entry = this.workers.get(accountId)
    if (entry) this.stop(accountId, entry)
  }

  dispose(): void {
    for (const [accountId, entry] of this.workers) this.stop(accountId, entry)
    this.workers.clear()
  }

  private spawn(accountId: number): WorkerEntry {
    const process = utilityProcess.fork(join(__dirname, 'email-oauth-worker.js'), [], {
      serviceName: `PAGE-AUTO email oauth #${accountId}`
    })
    let resolveSpawn: (() => void) | null = null
    let rejectSpawn: ((error: Error) => void) | null = null
    const spawned = new Promise<void>((resolve, reject) => {
      resolveSpawn = resolve
      rejectSpawn = reject
    })
    const entry: WorkerEntry = { process, spawned, pending: null }
    this.workers.set(accountId, entry)

    process.once('spawn', () => resolveSpawn?.())
    process.on('message', (message) => {
      if (isMailboxProviderWorkerRequestMessage(message)) {
        void this.handleMailboxProviderRequest(entry, message)
        return
      }
      if (!isWorkerResult(message) || message.accountId !== accountId) return
      const pending = entry.pending
      if (!pending) return
      entry.pending = null
      clearTimeout(pending.timer)
      pending.resolve({
        accountId: message.accountId,
        status: message.status,
        ...(message.code ? { code: message.code } : {}),
        ...(message.needsAttentionReason ? { needsAttentionReason: message.needsAttentionReason } : {}),
        proxyManagedExternally: message.proxyManagedExternally,
        message: message.message
      })
      if (message.status !== 'needs_attention') this.stop(accountId, entry)
    })
    process.once('exit', () => {
      rejectSpawn?.(new Error('Email OAuth worker đã thoát trước khi khởi động.'))
      const pending = entry.pending
      entry.pending = null
      if (pending) {
        clearTimeout(pending.timer)
        pending.resolve({
          accountId,
          status: 'error',
          proxyManagedExternally: false,
          message: 'Email OAuth worker đã thoát trước khi phản hồi.'
        })
      }
      if (this.workers.get(accountId) === entry) this.workers.delete(accountId)
    })
    return entry
  }

  private async handleMailboxProviderRequest(
    entry: WorkerEntry,
    request: MailboxProviderWorkerRequestMessage
  ): Promise<void> {
    let response
    try {
      response = this.mailboxProviderRequestHandler
        ? await this.mailboxProviderRequestHandler(request)
        : mailboxProviderUnavailableResponse(request, 'Main chưa đăng ký mailbox provider cho OAuth worker.')
    } catch {
      response = mailboxProviderUnavailableResponse(request, 'Main mailbox provider gặp lỗi khi OAuth worker yêu cầu code.')
    }
    try { entry.process.postMessage(response) } catch { /* worker đã đóng */ }
  }

  private stop(accountId: number, entry: WorkerEntry): void {
    if (this.workers.get(accountId) === entry) this.workers.delete(accountId)
    const pending = entry.pending
    entry.pending = null
    if (pending) clearTimeout(pending.timer)
    entry.process.kill()
  }
}
