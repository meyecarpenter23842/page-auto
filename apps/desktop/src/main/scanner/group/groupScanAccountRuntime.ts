import type Database from 'better-sqlite3'
import type { AccountRecord } from '../../../shared/accounts'
import type { StartScanJobInput } from '../../../shared/scanner'
import { resolveFacebookProfileDirectory } from '../../browser/facebookProfileResolver'
import { resolveAccountProxyState } from '../../browser/proxyConfig'
import { AccountRepository } from '../../database/accountRepository'
import { AppSettingsRepository } from '../../database/appSettingsRepository'
import { AccountExecutionCoordinator } from '../../services/accountExecutionCoordinator'
import { ScanAdapterRuntimeError, type ScanAdapterControl } from '../scanAdapter'
import type { GroupScanRawRecord, GroupScanRuntime } from './groupScanAdapter'
import { GroupScanWorkerManager } from './groupScanWorkerManager'
import type { GroupScanWorkerJob, GroupScanWorkerSessionUpdate } from './groupScanWorkerContracts'

function runtimeAccount(account: AccountRecord): GroupScanWorkerJob['sessionAccount'] {
  return {
    id: account.id,
    uid: account.uid,
    username: account.username,
    password: account.password,
    cookie: account.cookie,
    twoFactorSecret: account.twoFactorSecret,
    name: account.name
  }
}

function safeLimit(value: number): number {
  return Math.max(1, Math.min(50_000, Math.floor(Number.isFinite(value) ? value : 100)))
}

export class GroupScanAccountRuntime implements GroupScanRuntime {
  private readonly accounts: AccountRepository
  private readonly settings: AppSettingsRepository
  private readonly accountExecution = new AccountExecutionCoordinator()
  private readonly workers: GroupScanWorkerManager

  constructor(
    database: Database.Database,
    private readonly dataDirectory: string,
    workers?: GroupScanWorkerManager
  ) {
    this.accounts = new AccountRepository(database)
    this.settings = new AppSettingsRepository(database)
    this.workers = workers ?? new GroupScanWorkerManager(
      () => this.settings.get().runtime,
      (accountId, update) => this.persistSessionUpdate(accountId, update)
    )
  }

  async *scan(input: StartScanJobInput, control: ScanAdapterControl): AsyncIterable<GroupScanRawRecord> {
    if (input.source.type !== 'account' || input.source.accountId === null) {
      throw new ScanAdapterRuntimeError('needs_attention', 'Quét Nhóm production cần nguồn Account Page-Auto.')
    }
    const accountId = input.source.accountId
    const lease = this.accountExecution.tryAcquireLease(accountId)
    if (!lease) {
      throw new ScanAdapterRuntimeError(
        'needs_attention',
        `Account #${accountId} đang được workflow khác điều khiển. Hãy dừng flow đó hoặc chọn account khác.`
      )
    }

    try {
      const account = this.accounts.getById(accountId)
      if (!account) throw new ScanAdapterRuntimeError('failed', `Không tìm thấy account #${accountId}.`)
      if (account.status === 'disabled') {
        throw new ScanAdapterRuntimeError('needs_attention', `Account #${accountId} đang bị tắt trong Account Manager.`)
      }

      const settings = this.settings.get()
      const profileDirectory = resolveFacebookProfileDirectory(this.dataDirectory, account, settings.browser).profileDirectory
      const proxyResolution = resolveAccountProxyState(account)
      if (proxyResolution.status === 'invalid') throw new ScanAdapterRuntimeError('failed', proxyResolution.message)
      const proxy = proxyResolution.status === 'valid' ? proxyResolution.proxy : undefined

      const job: GroupScanWorkerJob = {
        runKey: `scanner-group-${accountId}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        accountId,
        profileDirectory,
        browser: { ...settings.browser },
        session: { ...settings.session },
        network: { ...settings.network },
        sessionAccount: runtimeAccount(account),
        query: input.query,
        filters: { ...input.filters },
        limit: safeLimit(input.limit),
        ...(account.userAgent ? { userAgent: account.userAgent } : {}),
        ...(proxy ? { proxy } : {})
      }
      for await (const record of this.workers.run(job, control)) yield record
    } finally {
      lease.release()
    }
  }

  dispose(): void {
    this.workers.closeAll()
  }

  private persistSessionUpdate(accountId: number, update: GroupScanWorkerSessionUpdate): void {
    const account = this.accounts.getById(accountId)
    if (!account) return
    const now = Date.now()
    this.accounts.update(accountId, {
      status: update.accountStatus ?? account.status,
      cookie: update.sessionCookie ?? account.cookie,
      name: account.name ?? update.accountName,
      cookieStatus: update.accountStatus === 'valid' ? 'valid' : account.cookieStatus,
      lastCookieCheck: update.accountStatus ? now : account.lastCookieCheck,
      lastUsedAt: update.accountStatus === 'valid' ? now : account.lastUsedAt
    })
  }
}
