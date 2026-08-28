import type { AccountRecord } from '../../shared/accounts'
import type {
  FacebookCheckpoint282Result,
  FacebookCheckpoint282RunPayload,
  FacebookCheckpointWorkbenchKind
} from '../../shared/facebookCheckpoint'
import type { BrowserProfileManager } from '../browser/browserProfileManager'
import { AccountExecutionCoordinator, type AccountExecutionLease } from './accountExecutionCoordinator'
import { Checkpoint282RunLifecycle } from './checkpoint282RunLifecycle'

function checkpointKind(payload: FacebookCheckpoint282RunPayload): FacebookCheckpointWorkbenchKind {
  return payload.checkpointKind ?? '282'
}

function busyResult(account: AccountRecord, payload: FacebookCheckpoint282RunPayload): FacebookCheckpoint282Result {
  const target = checkpointKind(payload)
  return {
    accountId: account.id,
    uid: account.uid,
    state: 'error',
    surface: payload.surface,
    checkpointKind: target,
    message: `Account/profile đang được nghiệp vụ khác sử dụng; thử lại CP${target} sau khi lượt hiện tại được giải phóng.`
  }
}

function stoppedResult(account: AccountRecord, payload: FacebookCheckpoint282RunPayload): FacebookCheckpoint282Result {
  const target = checkpointKind(payload)
  return {
    accountId: account.id,
    uid: account.uid,
    state: 'stopped',
    surface: payload.surface,
    checkpointKind: target,
    message: `Đã dừng CP${target} và đóng browser của account.`
  }
}

export function mapCheckpoint956ProbeResult(
  account: AccountRecord,
  payload: FacebookCheckpoint282RunPayload,
  probe: FacebookCheckpoint282Result
): FacebookCheckpoint282Result {
  if (probe.state === 'resolved') {
    return {
      accountId: account.id,
      uid: account.uid,
      state: 'resolved',
      surface: payload.surface,
      checkpointKind: '956',
      message: 'CP956 đã được xử lý; Facebook Common đã xác minh lại session/account.',
      ...(probe.evidencePath ? { evidencePath: probe.evidencePath } : {})
    }
  }

  if (probe.state === 'different_checkpoint' && probe.checkpointKind === '956') {
    return {
      accountId: account.id,
      uid: account.uid,
      state: 'waiting_manual',
      surface: payload.surface,
      checkpointKind: '956',
      message: 'Đã nhận diện CP956. Hoàn tất bước Facebook yêu cầu trên browser rồi bấm Kiểm tra lại.'
    }
  }

  if (probe.state === 'waiting_manual') {
    return {
      accountId: account.id,
      uid: account.uid,
      state: 'different_checkpoint',
      surface: payload.surface,
      checkpointKind: probe.checkpointKind ?? '282',
      message: `Account đang ở checkpoint ${probe.checkpointKind ?? '282'}, không chạy flow CP956.`
    }
  }

  if (probe.state === 'different_checkpoint') {
    return {
      accountId: account.id,
      uid: account.uid,
      state: 'different_checkpoint',
      surface: payload.surface,
      ...(probe.checkpointKind ? { checkpointKind: probe.checkpointKind } : {}),
      message: `Account đang ở checkpoint ${probe.checkpointKind ?? 'khác'}, không chạy flow CP956.`
    }
  }

  if (probe.state === 'needs_login') {
    return {
      accountId: account.id,
      uid: account.uid,
      state: 'needs_login',
      surface: payload.surface,
      checkpointKind: '956',
      message: 'Session chưa hợp lệ. Hoàn tất đăng nhập hợp lệ trên browser rồi bấm Kiểm tra lại CP956.'
    }
  }

  return {
    ...probe,
    checkpointKind: '956',
    message: probe.state === 'error' ? `CP956: ${probe.message}` : probe.message
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
    const target = checkpointKind(payload)
    if (payload.action === 'stop') return this.stop(account, payload)
    if (this.activeRuns.has(account.id)) {
      return {
        accountId: account.id,
        uid: account.uid,
        state: 'error',
        surface: payload.surface,
        checkpointKind: target,
        message: `Account đang có một lượt CP${target} khác; chờ lượt hiện tại hoàn tất hoặc bấm Dừng.`
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
      if (target === '956') {
        const probe = await this.browser.runCheckpoint282(account, {
          surface: payload.surface,
          action: payload.action,
          evidenceFolder: payload.evidenceFolder ?? null,
          asset: null
        })
        result = this.stopRequested.has(account.id)
          ? stoppedResult(account, payload)
          : mapCheckpoint956ProbeResult(account, payload, probe)
      } else {
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
      }
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
    if (checkpointKind(payload) === '956') return stoppedResult(account, payload)
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
