import type { AccountRecord } from '../../shared/accounts'
import type {
  FacebookCheckpoint282Result,
  FacebookCheckpoint282RunPayload,
  FacebookCheckpointWorkbenchKind
} from '../../shared/facebookCheckpoint'
import type { BrowserProfileManager } from '../browser/browserProfileManager'
import { AccountExecutionCoordinator, type AccountExecutionLease } from './accountExecutionCoordinator'
import { Checkpoint282RunLifecycle } from './checkpoint282RunLifecycle'

export const CHECKPOINT956_HOLD_TIMEOUT_MS = 10 * 60_000

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

function timeoutResult(account: AccountRecord, payload: FacebookCheckpoint282RunPayload): FacebookCheckpoint282Result {
  return {
    accountId: account.id,
    uid: account.uid,
    state: 'checkpoint_timeout',
    surface: payload.surface,
    checkpointKind: '956',
    message: 'Phiên giữ live CP956 đã hết thời gian an toàn; browser/lease đã được đóng và giải phóng. Có thể chạy lại account.'
  }
}

function browserClosedResult(account: AccountRecord, payload: FacebookCheckpoint282RunPayload): FacebookCheckpoint282Result {
  return {
    accountId: account.id,
    uid: account.uid,
    state: 'error',
    surface: payload.surface,
    checkpointKind: '956',
    message: 'Browser CP956 đã đóng/crash trong lúc chờ operator; lease đã được giải phóng. Có thể chạy lại account.'
  }
}

export interface Checkpoint282BrowserRuntime {
  runCheckpoint282: BrowserProfileManager['runCheckpoint282']
  runCheckpoint956: BrowserProfileManager['runCheckpoint956']
  closeAccount: BrowserProfileManager['closeAccount']
  onAccountClosed?: BrowserProfileManager['onAccountClosed']
}

export class Checkpoint282RuntimeController {
  private readonly leases = new Map<number, AccountExecutionLease>()
  private readonly activeRuns = new Set<number>()
  private readonly stopRequested = new Set<number>()
  private readonly holdTimers = new Map<number, NodeJS.Timeout>()
  private readonly holdExpired = new Set<number>()
  private readonly browserClosedWhileHeld = new Set<number>()
  private readonly expectedClose = new Set<number>()
  private readonly removeBrowserClosedListener: (() => void) | null

  constructor(
    private readonly accountExecution: AccountExecutionCoordinator,
    private readonly lifecycle: Checkpoint282RunLifecycle,
    private readonly browser: Checkpoint282BrowserRuntime,
    private readonly checkpoint956HoldTimeoutMs = CHECKPOINT956_HOLD_TIMEOUT_MS
  ) {
    this.removeBrowserClosedListener = this.browser.onAccountClosed?.((accountId) => {
      this.handleBrowserClosed(accountId)
    }) ?? null
  }

  async run(account: AccountRecord, payload: FacebookCheckpoint282RunPayload): Promise<FacebookCheckpoint282Result> {
    const target = checkpointKind(payload)
    if (payload.action === 'stop') return this.stop(account, payload)

    if (target === '956' && payload.action === 'recheck') {
      if (this.holdExpired.delete(account.id)) {
        this.browserClosedWhileHeld.delete(account.id)
        return timeoutResult(account, payload)
      }
      if (this.browserClosedWhileHeld.delete(account.id)) return browserClosedResult(account, payload)
    }

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

    this.clearHoldTimer(account.id)
    this.activeRuns.add(account.id)
    let result: FacebookCheckpoint282Result
    try {
      if (target === '956') {
        try {
          result = await this.browser.runCheckpoint956(account, {
            surface: payload.surface,
            action: payload.action,
            evidenceFolder: payload.evidenceFolder ?? null
          })
        } catch (cause) {
          result = {
            accountId: account.id,
            uid: account.uid,
            state: 'error',
            surface: payload.surface,
            checkpointKind: '956',
            message: cause instanceof Error ? cause.message : String(cause)
          }
        }
        if (this.stopRequested.has(account.id)) result = stoppedResult(account, payload)
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

    const keepBrowserForOperator = target === '956'
      ? result.state === 'waiting' || result.state === 'needs_attention' || result.state === 'needs_login'
      : result.state === 'waiting_manual' || result.state === 'needs_login'

    if (!keepBrowserForOperator) {
      await this.releaseAccount(account.id)
      return result
    }

    if (target === '956') {
      const holdExpiresAt = Date.now() + Math.max(1_000, this.checkpoint956HoldTimeoutMs)
      this.armHoldWatchdog(account.id)
      return { ...result, holdExpiresAt }
    }
    return result
  }

  dispose(): void {
    this.removeBrowserClosedListener?.()
    for (const timer of this.holdTimers.values()) clearTimeout(timer)
    this.holdTimers.clear()
    for (const lease of this.leases.values()) lease.release()
    this.leases.clear()
  }

  private armHoldWatchdog(accountId: number): void {
    this.clearHoldTimer(accountId)
    const timeoutMs = Math.max(1_000, this.checkpoint956HoldTimeoutMs)
    const timer = setTimeout(() => {
      if (!this.leases.has(accountId) || this.activeRuns.has(accountId)) return
      this.holdTimers.delete(accountId)
      this.holdExpired.add(accountId)
      this.browserClosedWhileHeld.delete(accountId)
      void this.releaseAccount(accountId)
    }, timeoutMs)
    this.holdTimers.set(accountId, timer)
  }

  private clearHoldTimer(accountId: number): void {
    const timer = this.holdTimers.get(accountId)
    if (!timer) return
    clearTimeout(timer)
    this.holdTimers.delete(accountId)
  }

  private handleBrowserClosed(accountId: number): void {
    if (this.expectedClose.has(accountId) || this.activeRuns.has(accountId)) return
    if (!this.leases.has(accountId)) return
    this.clearHoldTimer(accountId)
    this.browserClosedWhileHeld.add(accountId)
    this.releaseLeaseOnly(accountId)
  }

  private async stop(account: AccountRecord, payload: FacebookCheckpoint282RunPayload): Promise<FacebookCheckpoint282Result> {
    this.clearHoldTimer(account.id)
    this.holdExpired.delete(account.id)
    this.browserClosedWhileHeld.delete(account.id)

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

  private releaseLeaseOnly(accountId: number): void {
    const lease = this.leases.get(accountId)
    if (!lease) return
    this.leases.delete(accountId)
    lease.release()
  }

  private async releaseAccount(accountId: number): Promise<void> {
    this.clearHoldTimer(accountId)
    this.expectedClose.add(accountId)
    try {
      await this.browser.closeAccount(accountId)
    } finally {
      this.expectedClose.delete(accountId)
      this.releaseLeaseOnly(accountId)
    }
  }
}
