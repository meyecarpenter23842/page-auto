import type { AccountRecord } from '../../shared/accounts'
import type { BrowserRetileResult } from '../../shared/browserWindowLayout'
import type {
  HotmailBrowserOpenResult,
  HotmailPasswordActionResult,
  HotmailRecoveryActionResult,
  HotmailRecoveryOperation
} from '../../shared/hotmail'
import { EmailBrowserManager } from './emailBrowserManager'
import { EmailBrowserWindowLayoutRuntime } from './emailBrowserWindowLayout'
import type { MailboxProviderWorkerRequestHandler } from './mailboxProviderWorkerRpc'
import { EmailProxyPool, type EmailProxyCandidate, type EmailProxySettingsRaw } from './emailProxyPool'
import { EmailRuntimeOwnership, type EmailRuntimeOwner } from './emailRuntimeOwnership'
import { PrimaryMailboxBrowserManager } from './primaryMailboxBrowserManager'
import { primaryMailboxProviderLabel, resolvePrimaryMailboxOpenRoute } from './primaryMailboxOpenPolicy'

export type EmailRuntimeWorkflowOwner = Extract<EmailRuntimeOwner, 'combo'>

function runtimeBusyMessage(owner: EmailRuntimeOwner): string {
  const label = owner === 'password'
    ? 'đổi Password'
    : owner === 'recovery'
      ? 'Mail khôi phục'
      : 'Combo Email'
  return `Account Email đang có workflow ${label} hoạt động; không chạy thao tác browser song song trên cùng UID.`
}

function openError(accountId: number, message: string): HotmailBrowserOpenResult {
  return {
    accountId,
    status: 'error',
    message,
    profileDirectory: null,
    attached: false,
    proxyManagedExternally: false
  }
}

function passwordError(accountId: number, message: string): HotmailPasswordActionResult & { proxyManagedExternally: boolean } {
  return {
    accountId,
    passwordUpdated: false,
    status: 'error',
    message,
    proxyManagedExternally: false
  }
}

function recoveryError(
  accountId: number,
  operation: HotmailRecoveryOperation,
  backupEmail: string | null,
  message: string
): HotmailRecoveryActionResult & { proxyManagedExternally: boolean } {
  return {
    accountId,
    operation,
    backupEmail,
    status: 'error',
    message,
    proxyManagedExternally: false
  }
}

function keepsVisibleBrowser(status: HotmailBrowserOpenResult['status']): boolean {
  return status === 'started' || status === 'already_open' || status === 'needs_attention'
}

/**
 * EA1 Email Common Runtime foundation.
 *
 * Owns Email browser workers, Email proxy assignments, per-account workflow ownership
 * and an Email-only Compact slot pool. Placement math/native bounds are shared with the
 * Facebook BrowserWindowLayoutManager; only slot ownership/config are separate.
 */
export class EmailCommonRuntime {
  readonly proxyPool: EmailProxyPool
  private readonly managers = new Map<number, EmailBrowserManager>()
  private readonly primaryMailboxManagers = new Map<number, PrimaryMailboxBrowserManager>()
  private readonly ownership = new EmailRuntimeOwnership()

  constructor(
    getProxySettings: () => EmailProxySettingsRaw,
    private readonly mailboxProviderRequestHandler?: MailboxProviderWorkerRequestHandler,
    private readonly windowLayout?: EmailBrowserWindowLayoutRuntime
  ) {
    this.proxyPool = new EmailProxyPool(getProxySettings)
  }

  currentOwner(accountId: number): EmailRuntimeOwner | null {
    return this.ownership.current(accountId)
  }

  isOpen(accountId: number): boolean {
    return (this.managers.get(accountId)?.isOpen(accountId) ?? false)
      || (this.primaryMailboxManagers.get(accountId)?.isOpen(accountId) ?? false)
  }

  async open(
    account: AccountRecord,
    profileRoot: string,
    browserExecutable: string,
    proxy: EmailProxyCandidate | null
  ): Promise<HotmailBrowserOpenResult> {
    const owner = this.ownership.current(account.id)
    if (owner) return openError(account.id, runtimeBusyMessage(owner))

    const placement = this.windowLayout?.claim(account.id) ?? null
    const route = resolvePrimaryMailboxOpenRoute(account.email)
    let result: HotmailBrowserOpenResult
    if (route.kind === 'microsoft') {
      result = await this.managerFor(account.id).open(account, profileRoot, browserExecutable, proxy, placement)
    } else if (route.kind === 'browser_provider') {
      result = await this.primaryMailboxManagerFor(account.id).open(account, profileRoot, browserExecutable, proxy, placement)
    } else {
      const mailbox = account.email?.trim() || 'chưa có Email'
      result = openError(
        account.id,
        `Không mở Outlook thay cho mail chính ${mailbox}. ${primaryMailboxProviderLabel(route.providerId)} chưa có surface Mở mail được audit.`
      )
    }

    if (!keepsVisibleBrowser(result.status)) this.windowLayout?.release(account.id)
    return result
  }

  async runRecoveryAction(
    account: AccountRecord,
    profileRoot: string,
    browserExecutable: string,
    proxy: EmailProxyCandidate | null,
    operation: HotmailRecoveryOperation,
    backupEmail: string | null,
    recoveryEmail: string | null,
    confirmCompleted: boolean
  ): Promise<HotmailRecoveryActionResult & { proxyManagedExternally: boolean }> {
    if (!this.ownership.claim(account.id, 'recovery', confirmCompleted)) {
      const owner = this.ownership.current(account.id)
      return recoveryError(
        account.id,
        operation,
        backupEmail,
        owner ? runtimeBusyMessage(owner) : 'Không còn workflow Mail khôi phục đang chờ trên Email runtime.'
      )
    }

    const placement = this.windowLayout?.claim(account.id) ?? null
    try {
      const result = await this.managerFor(account.id).runRecoveryAction(
        account,
        profileRoot,
        browserExecutable,
        proxy,
        operation,
        backupEmail,
        recoveryEmail,
        confirmCompleted,
        placement
      )
      if (result.status !== 'needs_attention') {
        this.ownership.release(account.id, 'recovery')
        this.windowLayout?.release(account.id)
      }
      return result
    } catch (error) {
      this.ownership.release(account.id, 'recovery')
      this.windowLayout?.release(account.id)
      throw error
    }
  }

  async runPasswordAction(
    account: AccountRecord,
    profileRoot: string,
    browserExecutable: string,
    proxy: EmailProxyCandidate | null,
    newPassword: string,
    confirmCompleted: boolean
  ): Promise<HotmailPasswordActionResult & { proxyManagedExternally: boolean }> {
    if (!this.ownership.claim(account.id, 'password', confirmCompleted)) {
      const owner = this.ownership.current(account.id)
      return passwordError(
        account.id,
        owner ? runtimeBusyMessage(owner) : 'Không còn workflow đổi Password đang chờ trên Email runtime.'
      )
    }

    const placement = this.windowLayout?.claim(account.id) ?? null
    try {
      const result = await this.managerFor(account.id).runPasswordAction(
        account,
        profileRoot,
        browserExecutable,
        proxy,
        newPassword,
        confirmCompleted,
        placement
      )
      if (result.status !== 'needs_attention') {
        this.ownership.release(account.id, 'password')
        this.windowLayout?.release(account.id)
      }
      return result
    } catch (error) {
      this.ownership.release(account.id, 'password')
      this.windowLayout?.release(account.id)
      throw error
    }
  }

  async openWorkflow(
    owner: EmailRuntimeWorkflowOwner,
    account: AccountRecord,
    profileRoot: string,
    browserExecutable: string,
    proxy: EmailProxyCandidate | null
  ): Promise<HotmailBrowserOpenResult> {
    if (!this.ownership.claim(account.id, owner)) {
      const current = this.ownership.current(account.id)
      return openError(account.id, current ? runtimeBusyMessage(current) : 'Không thể giữ ownership Email runtime cho workflow.')
    }

    const placement = this.windowLayout?.claim(account.id) ?? null
    try {
      const result = await this.managerFor(account.id).open(account, profileRoot, browserExecutable, proxy, placement)
      if (!keepsVisibleBrowser(result.status)) {
        this.ownership.release(account.id, owner)
        this.closeAccount(account.id)
      }
      return result
    } catch (error) {
      this.ownership.release(account.id, owner)
      this.closeAccount(account.id)
      throw error
    }
  }

  async runWorkflowPasswordAction(
    owner: EmailRuntimeWorkflowOwner,
    account: AccountRecord,
    profileRoot: string,
    browserExecutable: string,
    proxy: EmailProxyCandidate | null,
    newPassword: string,
    confirmCompleted: boolean
  ): Promise<HotmailPasswordActionResult & { proxyManagedExternally: boolean }> {
    if (this.ownership.current(account.id) !== owner) {
      return passwordError(account.id, 'Combo Email không còn ownership của Email profile này.')
    }
    return await this.managerFor(account.id).runPasswordAction(
      account,
      profileRoot,
      browserExecutable,
      proxy,
      newPassword,
      confirmCompleted,
      this.windowLayout?.placementFor(account.id) ?? null
    )
  }

  async runWorkflowRecoveryAction(
    owner: EmailRuntimeWorkflowOwner,
    account: AccountRecord,
    profileRoot: string,
    browserExecutable: string,
    proxy: EmailProxyCandidate | null,
    operation: HotmailRecoveryOperation,
    backupEmail: string | null,
    confirmCompleted: boolean
  ): Promise<HotmailRecoveryActionResult & { proxyManagedExternally: boolean }> {
    if (this.ownership.current(account.id) !== owner) {
      return recoveryError(account.id, operation, backupEmail, 'Combo Email không còn ownership của Email profile này.')
    }
    return await this.managerFor(account.id).runRecoveryAction(
      account,
      profileRoot,
      browserExecutable,
      proxy,
      operation,
      backupEmail,
      null,
      confirmCompleted,
      this.windowLayout?.placementFor(account.id) ?? null
    )
  }

  async retileWindows(): Promise<BrowserRetileResult> {
    if (!this.windowLayout) {
      return { status: 'not_compact', appliedCount: 0, overflowCount: 0, message: 'Email Compact chưa được cấu hình.' }
    }
    const plan = this.windowLayout.retilePlan()
    if (plan.result.status !== 'success') return plan.result

    let appliedCount = 0
    for (const [accountId, placement] of plan.placements) {
      const microsoft = this.managers.get(accountId)
      const primary = this.primaryMailboxManagers.get(accountId)
      const applied = microsoft
        ? await microsoft.applyPlacement(accountId, placement)
        : primary
          ? await primary.applyPlacement(accountId, placement)
          : false
      if (applied) appliedCount += 1
    }
    return {
      ...plan.result,
      appliedCount,
      message: plan.result.overflowCount > 0
        ? `Đã sắp xếp ${appliedCount} Chrome Email; ${plan.result.overflowCount} cửa sổ nằm ở lớp tràn.`
        : `Đã sắp xếp ${appliedCount} Chrome Email theo grid hiện tại.`
    }
  }

  closeWorkflow(accountId: number, owner: EmailRuntimeWorkflowOwner): void {
    this.ownership.release(accountId, owner)
    this.closeAccount(accountId)
  }

  closeAccount(accountId: number): void {
    const manager = this.managers.get(accountId)
    const primaryMailboxManager = this.primaryMailboxManagers.get(accountId)
    this.managers.delete(accountId)
    this.primaryMailboxManagers.delete(accountId)
    this.ownership.clear(accountId)
    this.proxyPool.release(accountId)
    this.windowLayout?.release(accountId)
    manager?.closeAll()
    primaryMailboxManager?.closeAll()
  }

  closeAll(): void {
    const accountIds = [...new Set([
      ...this.managers.keys(),
      ...this.primaryMailboxManagers.keys()
    ])]
    const managers = [...new Set(this.managers.values())]
    const primaryMailboxManagers = [...new Set(this.primaryMailboxManagers.values())]
    this.managers.clear()
    this.primaryMailboxManagers.clear()
    this.ownership.clearAll()
    for (const accountId of accountIds) {
      this.proxyPool.release(accountId)
      this.windowLayout?.release(accountId)
    }
    for (const manager of managers) manager.closeAll()
    for (const manager of primaryMailboxManagers) manager.closeAll()
  }

  private managerFor(accountId: number): EmailBrowserManager {
    const existing = this.managers.get(accountId)
    if (existing) return existing

    const releasePlacement = (closedAccountId: number) => this.windowLayout?.release(closedAccountId)
    const manager = new EmailBrowserManager((closedAccountId) => {
      this.proxyPool.release(closedAccountId)
      this.ownership.clear(closedAccountId)
      releasePlacement(closedAccountId)
      if (this.managers.get(closedAccountId) === manager) this.managers.delete(closedAccountId)
    }, this.mailboxProviderRequestHandler, releasePlacement)
    this.managers.set(accountId, manager)
    return manager
  }

  private primaryMailboxManagerFor(accountId: number): PrimaryMailboxBrowserManager {
    const existing = this.primaryMailboxManagers.get(accountId)
    if (existing) return existing

    const releasePlacement = (closedAccountId: number) => this.windowLayout?.release(closedAccountId)
    const manager = new PrimaryMailboxBrowserManager((closedAccountId) => {
      this.proxyPool.release(closedAccountId)
      releasePlacement(closedAccountId)
      if (this.primaryMailboxManagers.get(closedAccountId) === manager) {
        this.primaryMailboxManagers.delete(closedAccountId)
      }
    }, releasePlacement)
    this.primaryMailboxManagers.set(accountId, manager)
    return manager
  }
}
