import type { AccountRecord } from '../../shared/accounts'
import type {
  FacebookCheckpoint282Result,
  FacebookCheckpoint282RunPayload
} from '../../shared/facebookCheckpoint'
import type { BrowserProfileManager } from '../browser/browserProfileManager'
import { AccountExecutionCoordinator, type AccountExecutionLease } from './accountExecutionCoordinator'
import { Checkpoint282RunLifecycle } from './checkpoint282RunLifecycle'

function busyResult(account: AccountRecord, payload: FacebookCheckpoint282RunPayload): FacebookCheckpoint282Result {
  return {
    accountId: account.id,
    uid: account.uid,
    state: 'error',
    surface: payload.surface,
    message: 'Account/profile đang được nghiệp vụ khác sử dụng; thử lại sau khi lượt hiện tại được giải phóng.'
  }
}

function stoppedResult(account: AccountRecord, payload: FacebookCheckpoint282RunPayload): FacebookCheckpoint282Result {
  return {
    accountId: account.id,
    uid: account.uid,
    state: 'stopped',
    surface: payload.surface,
    message: 'Đã dừng CP282 và đóng browser của account.'
  }
}

export interface Checkpoint282BrowserRuntime {
  runCheckpoint282: BrowserProfileManager['runCheckpoint282']
  closeAccount: BrowserProfileManager['closeAccount']
}

export class Checkpoint282RuntimeController {
  private readonly leases = new Map<number, AccountExecutionLease>()
  private readonly activeRuns = new Set<number>()
  private readonly stopRequested = new Set<number>()

  constructor(
    private readonly accountExecution: AccountExecutionCoordinator,
    private readonly lifecycle: Checkpoint282RunLifecycle,
    private readonly browser: Checkpoint282BrowserRuntime
  ) {}

  async run(account: AccountRecord, payload: FacebookCheckpoint282RunPayload): Promise<FacebookCheckpoint282Result> {
    if (payload.action === 'stop') return this.stop(account, payload)
    if (this.activeRuns.has(account.id)) {
      return {
        accountId: account.id,
        uid: account.uid,
        state: 'error',
        surface: payload.surface,
        message: 'Account đang có một lượt CP282 khác; chờ lượt hiện tại hoàn tất hoặc bấm Dừng.'
      }
    }

    let lease = this.leases.get(account.id)
    if (!lease) {
      lease = this.accountExecution.tryAcquireLease(account.id) ?? undefined
      if (!lease) return busyResult(account, payload)
      this.leases.set(account.id, lease)
    }

    this.activeRuns.add(account.id)
    let result: FacebookCheckpoint282Result
    try {
      result = await this.lifecycle.execute(
        account,
        payload,
        (runPayload) => this.browser.runCheckpoint282(account, runPayload),
        {
          normalizeResult: (candidate) => this.stopRequested.has(account.id)
            ? stoppedResult(account, payload)
            : candidate
        }
      )
    } finally {
      this.activeRuns.delete(account.id)
      this.stopRequested.delete(account.id)
    }

    const keepBrowserForOperator = result.state === 'waiting_manual' || result.state === 'needs_login'
    if (!keepBrowserForOperator) await this.releaseAccount(account.id)
    return result
  }

  private async stop(account: AccountRecord, payload: FacebookCheckpoint282RunPayload): Promise<FacebookCheckpoint282Result> {
    if (this.activeRuns.has(account.id)) {
      this.stopRequested.add(account.id)
      await this.browser.closeAccount(account.id)
      return stoppedResult(account, payload)
    }

    const hadLease = this.leases.has(account.id)
    await this.releaseAccount(account.id)
    return hadLease
      ? this.lifecycle.recordOperatorStop(account, payload.surface)
      : stoppedResult(account, payload)
  }

  private async releaseAccount(accountId: number): Promise<void> {
    try {
      await this.browser.closeAccount(accountId)
    } finally {
      const lease = this.leases.get(accountId)
      if (lease) {
        this.leases.delete(accountId)
        lease.release()
      }
    }
  }
}
