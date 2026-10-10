import type Database from 'better-sqlite3'
import type { AccountRecord } from '../../../shared/accounts'
import type { StartScanJobInput } from '../../../shared/scanner'
import { resolveFacebookProfileDirectory } from '../../browser/facebookProfileResolver'
import { resolveAccountProxyState } from '../../browser/proxyConfig'
import { AccountRepository } from '../../database/accountRepository'
import { AppSettingsRepository } from '../../database/appSettingsRepository'
import { ScannerRepository } from '../../database/scannerRepository'
import { AccountExecutionCoordinator } from '../../services/accountExecutionCoordinator'
import { ScanAdapterRuntimeError, type ScanAdapterControl } from '../scanAdapter'
import type { GroupMembersScanRawRecord, GroupMembersScanRuntime } from './groupMembersScanAdapter'
import {
  groupMembersTargetFromValue,
  parseGroupMembersTargets,
  type GroupMembersTarget
} from './groupMembersScanSupport'
import { GroupMembersScanWorkerManager } from './groupMembersScanWorkerManager'
import type {
  GroupMembersScanWorkerJob,
  GroupMembersScanWorkerSessionUpdate
} from './groupMembersScanWorkerContracts'

function runtimeAccount(account: AccountRecord): GroupMembersScanWorkerJob['sessionAccount'] {
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

function groupDatasetId(input: StartScanJobInput): number | null {
  const value = input.filters.groupDatasetId
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

export class GroupMembersScanAccountRuntime implements GroupMembersScanRuntime {
  private readonly accounts: AccountRepository
  private readonly settings: AppSettingsRepository
  private readonly scannerRepository: ScannerRepository
  private readonly accountExecution = new AccountExecutionCoordinator()
  private readonly workers: GroupMembersScanWorkerManager

  constructor(
    database: Database.Database,
    private readonly dataDirectory: string,
    workers?: GroupMembersScanWorkerManager
  ) {
    this.accounts = new AccountRepository(database)
    this.settings = new AppSettingsRepository(database)
    this.scannerRepository = new ScannerRepository(database)
    this.workers = workers ?? new GroupMembersScanWorkerManager(
      () => this.settings.get().runtime,
      (accountId, update) => this.persistSessionUpdate(accountId, update)
    )
  }

  async *scan(input: StartScanJobInput, control: ScanAdapterControl): AsyncIterable<GroupMembersScanRawRecord> {
    if (input.source.type !== 'account' || input.source.accountId === null) {
      throw new ScanAdapterRuntimeError('needs_attention', 'Thành viên nhóm production cần nguồn Account Page-Auto.')
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

      const groups = this.resolveGroups(input)
      if (!groups.length) {
        throw new ScanAdapterRuntimeError(
          'needs_attention',
          'Hãy nhập Group UID/URL hoặc chọn một Group Dataset để quét Thành viên nhóm.'
        )
      }

      const settings = this.settings.get()
      const profileDirectory = resolveFacebookProfileDirectory(this.dataDirectory, account, settings.browser).profileDirectory
      const proxyResolution = resolveAccountProxyState(account)
      if (proxyResolution.status === 'invalid') throw new ScanAdapterRuntimeError('failed', proxyResolution.message)
      const proxy = proxyResolution.status === 'valid' ? proxyResolution.proxy : undefined

      const job: GroupMembersScanWorkerJob = {
        runKey: `scanner-group-members-${accountId}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        accountId,
        profileDirectory,
        browser: { ...settings.browser },
        session: { ...settings.session },
        network: { ...settings.network },
        sessionAccount: runtimeAccount(account),
        groups,
        limit: safeLimit(input.limit),
        ...(account.userAgent ? { userAgent: account.userAgent } : {}),
        ...(proxy ? { proxy } : {})
      }
      for await (const record of this.workers.run(job, control)) yield record
    } finally {
      lease.release()
    }
  }

  dispose(): void { this.workers.closeAll() }

  private resolveGroups(input: StartScanJobInput): GroupMembersTarget[] {
    const candidates: GroupMembersTarget[] = [...parseGroupMembersTargets(input.query)]
    const datasetId = groupDatasetId(input)
    if (datasetId !== null) {
      const dataset = this.scannerRepository.getDataset(datasetId)
      if (!dataset) throw new ScanAdapterRuntimeError('needs_attention', `Không tìm thấy Group Dataset #${datasetId}.`)
      if (dataset.type !== 'group') {
        throw new ScanAdapterRuntimeError('needs_attention', `Dataset #${datasetId} không phải Group Dataset.`)
      }
      for (const item of dataset.items) {
        const target = groupMembersTargetFromValue(item.entityId)
          ?? (item.url ? groupMembersTargetFromValue(item.url) : null)
        if (target) candidates.push(target)
      }
    }

    const seen = new Set<string>()
    return candidates.filter((target) => {
      const key = target.groupId.toLocaleLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  private persistSessionUpdate(accountId: number, update: GroupMembersScanWorkerSessionUpdate): void {
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
