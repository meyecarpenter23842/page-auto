import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { AccountRecord } from '../../shared/accounts'
import type {
  HotmailBrowserOpenResult,
  HotmailPasswordActionResult,
  HotmailRecoveryActionResult,
  HotmailRecoveryOperation
} from '../../shared/hotmail'
import { shouldKeepEmailBrowserWorker } from './emailBrowserLifecycle'
import { ensureEmailProfileDirectory, inspectEmailProfile } from './emailProfileResolver'
import {
  nextEmailAuthResumeKind,
  shouldResumeEmailActionAfterAuth,
  type EmailAuthResumeKind
} from './emailLoginPolicy'
import type { EmailProxyCandidate } from './emailProxyPool'

interface WorkerOpenResult {
  type: 'open-result'
  accountId: number
  status: 'started' | 'already_open' | 'needs_attention' | 'profile_in_use' | 'error'
  attached: boolean
  proxyManagedExternally: boolean
  message: string
}

interface WorkerRecoveryResult {
  type: 'recovery-result'
  accountId: number
  operation: HotmailRecoveryOperation
  status: 'success' | 'needs_attention' | 'profile_in_use' | 'error'
  needsAttentionReason?: HotmailRecoveryActionResult['needsAttentionReason']
  proxyManagedExternally: boolean
  message: string
}

interface WorkerPasswordResult {
  type: 'password-result'
  accountId: number
  status: 'success' | 'needs_attention' | 'profile_in_use' | 'error'
  needsAttentionReason?: HotmailPasswordActionResult['needsAttentionReason']
  proxyManagedExternally: boolean
  message: string
}

type WorkerResponse = WorkerOpenResult | WorkerRecoveryResult | WorkerPasswordResult

type PendingKind = WorkerResponse['type']

interface WorkerPending {
  kind: PendingKind
  resolve: (result: WorkerResponse) => void
  timer: ReturnType<typeof setTimeout>
}

interface WorkerEntry {
  process: UtilityProcess
  profileDirectory: string
  pending: WorkerPending | null
  spawned: Promise<void>
  actionOnly: boolean
  authResumeKind: EmailAuthResumeKind | null
}

interface PreparedWorker {
  entry: WorkerEntry
  created: boolean
}

interface MissingWorker {
  status: 'missing_profile'
  profileDirectory: string | null
  message: string
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorkerResponse>
  return (candidate.type === 'open-result' || candidate.type === 'recovery-result' || candidate.type === 'password-result')
    && typeof candidate.accountId === 'number'
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

function loginPayload(account: AccountRecord) {
  return {
    ...(account.email?.trim() ? { loginEmail: account.email.trim() } : {}),
    ...(account.emailPassword ? { loginPassword: account.emailPassword } : {})
  }
}

function workerErrorResponse(kind: PendingKind, command: Record<string, unknown>, message: string): WorkerResponse {
  const accountId = Number(command.accountId)
  if (kind === 'open-result') {
    return {
      type: 'open-result', accountId, status: 'error', attached: false,
      proxyManagedExternally: false, message
    }
  }
  if (kind === 'password-result') {
    return {
      type: 'password-result', accountId, status: 'error',
      proxyManagedExternally: false, message
    }
  }
  return {
    type: 'recovery-result', accountId,
    operation: command.operation as HotmailRecoveryOperation,
    status: 'error', proxyManagedExternally: false, message
  }
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
    const prepared = await this.prepareWorker(account, profileRoot, false)
    if ('status' in prepared) {
      return this.openResult(account.id, prepared.status, prepared.profileDirectory, prepared.message, false, false)
    }
    const { entry } = prepared
    if (entry.pending) {
      return this.openResult(account.id, 'already_open', entry.profileDirectory, 'Email browser đang xử lý một thao tác khác.', false, false)
    }

    const response = await this.send(entry, 'open-result', {
      type: 'open-mail',
      accountId: account.id,
      profileDirectory: entry.profileDirectory,
      ...loginPayload(account),
      ...(browserExecutable.trim() ? { executablePath: browserExecutable.trim() } : {}),
      ...proxyPayload(proxy)
    }) as WorkerOpenResult

    const result: HotmailBrowserOpenResult = {
      accountId: account.id,
      status: response.status,
      message: response.message,
      profileDirectory: entry.profileDirectory,
      attached: response.attached,
      proxyManagedExternally: response.proxyManagedExternally
    }
    if (!shouldKeepEmailBrowserWorker(response.status)) this.stopEntry(account.id, entry)
    return result
  }

  async runRecoveryAction(
    account: AccountRecord,
    profileRoot: string,
    browserExecutable: string,
    proxy: EmailProxyCandidate | null,
    operation: HotmailRecoveryOperation,
    backupEmail: string | null,
    confirmCompleted: boolean
  ): Promise<HotmailRecoveryActionResult & { proxyManagedExternally: boolean }> {
    const prepared = await this.prepareWorker(account, profileRoot, true)
    if ('status' in prepared) {
      return {
        accountId: account.id,
        operation,
        backupEmail,
        status: prepared.status,
        message: prepared.message,
        proxyManagedExternally: false
      }
    }
    const { entry } = prepared
    if (entry.pending) {
      return {
        accountId: account.id,
        operation,
        backupEmail,
        status: 'error',
        message: 'Email browser đang xử lý một thao tác khác cho account này.',
        proxyManagedExternally: false
      }
    }

    const resumeAfterAuth = shouldResumeEmailActionAfterAuth(entry.authResumeKind, 'recovery-result', confirmCompleted)
    const response = await this.send(entry, 'recovery-result', {
      type: 'recovery-action',
      accountId: account.id,
      profileDirectory: entry.profileDirectory,
      operation,
      confirmCompleted: resumeAfterAuth ? false : confirmCompleted,
      ...loginPayload(account),
      ...(browserExecutable.trim() ? { executablePath: browserExecutable.trim() } : {}),
      ...proxyPayload(proxy)
    }) as WorkerRecoveryResult
    entry.authResumeKind = nextEmailAuthResumeKind('recovery-result', response.status, response.needsAttentionReason)

    const result = {
      accountId: account.id,
      operation,
      backupEmail,
      status: response.status,
      message: response.message,
      ...(response.needsAttentionReason ? { needsAttentionReason: response.needsAttentionReason } : {}),
      proxyManagedExternally: response.proxyManagedExternally
    } satisfies HotmailRecoveryActionResult & { proxyManagedExternally: boolean }

    if (entry.actionOnly && response.status !== 'needs_attention') this.stopEntry(account.id, entry)
    return result
  }

  async runPasswordAction(
    account: AccountRecord,
    profileRoot: string,
    browserExecutable: string,
    proxy: EmailProxyCandidate | null,
    newPassword: string,
    confirmCompleted: boolean
  ): Promise<HotmailPasswordActionResult & { proxyManagedExternally: boolean }> {
    const prepared = await this.prepareWorker(account, profileRoot, true)
    if ('status' in prepared) {
      return {
        accountId: account.id,
        passwordUpdated: false,
        status: prepared.status,
        message: prepared.message,
        proxyManagedExternally: false
      }
    }
    const { entry } = prepared
    if (entry.pending) {
      return {
        accountId: account.id,
        passwordUpdated: false,
        status: 'error',
        message: 'Email browser đang xử lý một thao tác khác cho account này.',
        proxyManagedExternally: false
      }
    }

    const resumeAfterAuth = shouldResumeEmailActionAfterAuth(entry.authResumeKind, 'password-result', confirmCompleted)
    const response = await this.send(entry, 'password-result', {
      type: 'password-action',
      accountId: account.id,
      profileDirectory: entry.profileDirectory,
      confirmCompleted: resumeAfterAuth ? false : confirmCompleted,
      ...loginPayload(account),
      ...(account.emailPassword ? { currentPassword: account.emailPassword } : {}),
      newPassword,
      ...(browserExecutable.trim() ? { executablePath: browserExecutable.trim() } : {}),
      ...proxyPayload(proxy)
    }) as WorkerPasswordResult
    entry.authResumeKind = nextEmailAuthResumeKind('password-result', response.status, response.needsAttentionReason)

    const result = {
      accountId: account.id,
      passwordUpdated: response.status === 'success',
      status: response.status,
      message: response.message,
      ...(response.needsAttentionReason ? { needsAttentionReason: response.needsAttentionReason } : {}),
      proxyManagedExternally: response.proxyManagedExternally
    } satisfies HotmailPasswordActionResult & { proxyManagedExternally: boolean }

    if (entry.actionOnly && response.status !== 'needs_attention') this.stopEntry(account.id, entry)
    return result
  }

  closeAll(): void {
    for (const [accountId, entry] of this.workers) this.stopEntry(accountId, entry)
    this.workers.clear()
  }

  isOpen(accountId: number): boolean {
    return this.workers.has(accountId)
  }

  private async prepareWorker(account: AccountRecord, profileRoot: string, actionOnly: boolean): Promise<PreparedWorker | MissingWorker> {
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
    if (existing) return { entry: existing, created: false }

    const process = utilityProcess.fork(join(__dirname, 'email-browser-worker.js'), [], {
      serviceName: `PAGE-AUTO email ${account.uid}`
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
      spawned,
      actionOnly,
      authResumeKind: null
    }
    this.workers.set(account.id, entry)

    process.once('spawn', () => resolveSpawn?.())
    process.on('message', (message) => {
      if (!isWorkerResponse(message) || message.accountId !== account.id) return
      const pending = entry.pending
      if (!pending || pending.kind !== message.type) return
      entry.pending = null
      clearTimeout(pending.timer)
      pending.resolve(message)
    })
    process.once('exit', () => {
      rejectSpawn?.(new Error('Email browser worker đã thoát trước khi khởi động.'))
      const pending = entry.pending
      entry.pending = null
      if (pending) {
        clearTimeout(pending.timer)
        pending.resolve(workerErrorResponse(
          pending.kind,
          { accountId: account.id, operation: 'add' },
          'Email browser worker đã thoát trước khi phản hồi.'
        ))
      }
      if (this.workers.get(account.id) === entry) this.workers.delete(account.id)
      this.onClosed?.(account.id)
    })

    return { entry, created: true }
  }

  private async send(entry: WorkerEntry, kind: PendingKind, command: Record<string, unknown>): Promise<WorkerResponse> {
    try {
      await entry.spawned
    } catch {
      return workerErrorResponse(kind, command, 'Email browser worker không khởi động được.')
    }

    return await new Promise<WorkerResponse>((resolve) => {
      const timer = setTimeout(() => {
        if (!entry.pending) return
        entry.pending = null
        const timeoutMessage = kind === 'password-result'
          ? 'Thao tác đổi Password Email quá thời gian chờ phản hồi.'
          : kind === 'recovery-result'
            ? 'Thao tác Mail khôi phục quá thời gian chờ phản hồi.'
            : 'Email browser quá thời gian chờ phản hồi.'
        resolve(workerErrorResponse(kind, command, timeoutMessage))
      }, 45_000)
      entry.pending = { kind, resolve, timer }
      try {
        entry.process.postMessage(command)
      } catch {
        clearTimeout(timer)
        entry.pending = null
        resolve(workerErrorResponse(kind, command, 'Không gửi được thao tác tới Email browser worker.'))
      }
    })
  }

  private stopEntry(accountId: number, entry: WorkerEntry): void {
    if (this.workers.get(accountId) === entry) this.workers.delete(accountId)
    entry.process.kill()
  }

  private openResult(
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
