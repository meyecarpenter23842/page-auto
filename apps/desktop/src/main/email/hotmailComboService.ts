import type { AccountRepository } from '../database/accountRepository'
import type { HotmailRepository } from '../database/hotmailRepository'
import type {
  HotmailActionStatus,
  HotmailNeedsAttentionReason,
  HotmailRecoveryOperation
} from '../../shared/hotmail'
import type {
  HotmailComboActionPayload,
  HotmailComboActionResult,
  HotmailComboBatchResult,
  HotmailComboOperation,
  HotmailComboRecoveryOperation,
  HotmailComboStage,
  HotmailComboStageResult
} from '../../shared/emailCombo'
import { EmailBrowserManager } from './emailBrowserManager'
import { inspectEmailProfile } from './emailProfileResolver'
import { EmailProxyPool, type EmailProxyCandidate } from './emailProxyPool'
import { canonicalBackupEmailAfterRecoverySuccess, validateRecoveryAction } from './emailAccountActionPolicy'
import { validateEmailPassword } from './emailPasswordActionPolicy'
import {
  advanceEmailComboStage,
  emailComboStagePlan,
  recoveryOperationForCombo,
  redactEmailComboSecrets
} from './emailComboActionPolicy'

type ResolveEmailBrowserExecutable = (requestedExecutable: string, profileRoot: string) => Promise<string>

interface ActiveComboAccount {
  accountId: number
  operation: HotmailComboOperation
  recoveryOperation: HotmailComboRecoveryOperation
  recoveryEmail: string
  newPassword: string
  stages: HotmailComboStage[]
  stageIndex: number
  history: HotmailComboStageResult[]
  completedStages: HotmailComboStage[]
  manager: EmailBrowserManager
  executable: string
  profileRoot: string
  proxy: EmailProxyCandidate | null
  proxyManagedExternally: boolean
  passwordUpdated: boolean
  backupEmail: string | null
}

interface StageOutcome {
  status: HotmailActionStatus
  message: string
  needsAttentionReason?: HotmailNeedsAttentionReason
}

function uniqueAccountIds(accountIds: number[]): number[] {
  return [...new Set(accountIds.filter((id) => Number.isInteger(id) && id > 0))]
}

export class HotmailComboService {
  private readonly proxyPool: EmailProxyPool
  private readonly active = new Map<number, ActiveComboAccount>()
  private running = false

  constructor(
    private readonly accounts: AccountRepository,
    private readonly repository: HotmailRepository,
    private readonly resolveBrowserExecutable: ResolveEmailBrowserExecutable
  ) {
    this.proxyPool = new EmailProxyPool(() => this.repository.getProxySettings())
  }

  hasActiveFlow(): boolean {
    return this.running || this.active.size > 0
  }

  async run(payload: HotmailComboActionPayload): Promise<HotmailComboBatchResult> {
    if (this.running) throw new Error('Combo Email đang xử lý. Hãy chờ thao tác hiện tại hoàn tất.')
    this.running = true
    try {
      return payload.confirmCompleted ? await this.continuePending() : await this.start(payload)
    } finally {
      this.running = false
    }
  }

  dispose(): void {
    for (const state of this.active.values()) state.manager.closeAll()
    this.active.clear()
  }

  private async start(payload: HotmailComboActionPayload): Promise<HotmailComboBatchResult> {
    if (this.active.size > 0) {
      throw new Error('Đang có Combo Email chờ xử lý thủ công. Hoàn tất flow đó trước khi mở combo mới.')
    }
    if (!payload.operation) throw new Error('Chưa chọn loại Combo Email.')

    const newPassword = validateEmailPassword(payload.newPassword)
    const recoveryOperation = recoveryOperationForCombo(payload.operation, payload.recoveryOperation)
    const recoveryEmail = validateRecoveryAction(recoveryOperation, payload.recoveryEmail)
    if (!recoveryEmail) throw new Error('Combo Email cần Mail khôi phục mới hợp lệ.')

    const results: HotmailComboActionResult[] = []
    for (const accountId of uniqueAccountIds(payload.accountIds)) {
      results.push(await this.startAccount(accountId, payload.operation, recoveryOperation, recoveryEmail, newPassword))
    }
    return { results }
  }

  private async continuePending(): Promise<HotmailComboBatchResult> {
    if (this.active.size === 0) {
      throw new Error('Không có Combo Email nào đang chờ xác nhận. Hãy mở lại combo trước.')
    }

    const states = [...this.active.values()]
    const results: HotmailComboActionResult[] = []
    for (const state of states) {
      if (!state.manager.isOpen(state.accountId)) {
        const message = 'Phiên Email của Combo đã đóng; không thể tiếp tục bằng session mới. Kết quả stage trước vẫn được giữ.'
        this.repository.updateEmailState(state.accountId, { lastError: message })
        results.push(this.finishResult(state, 'error', message))
        this.finishAccount(state)
        continue
      }
      results.push(await this.runStages(state, true))
    }
    return { results }
  }

  private async startAccount(
    accountId: number,
    operation: HotmailComboOperation,
    recoveryOperation: HotmailComboRecoveryOperation,
    recoveryEmail: string,
    newPassword: string
  ): Promise<HotmailComboActionResult> {
    const account = this.accounts.getById(accountId)
    if (!account) return this.simpleError(accountId, 'Account không tồn tại.')
    if (!account.email) return this.simpleError(accountId, 'Account chưa có Email Microsoft.', account.backupEmail)
    if (account.emailPassword === newPassword) return this.simpleError(accountId, 'Password Email mới trùng Password canonical hiện tại.', account.backupEmail)

    const settings = this.repository.getProfileSettings()
    const inspection = await inspectEmailProfile(settings.profileRoot, account.uid)
    if (inspection.status === 'not_configured') {
      return this.simpleError(accountId, 'Chưa cấu hình Email Profile Root.', account.backupEmail, 'missing_profile')
    }

    const manager = new EmailBrowserManager((id) => this.proxyPool.release(id))
    let proxy: EmailProxyCandidate | null = null
    try {
      const executable = await this.resolveBrowserExecutable(settings.browserExecutable, settings.profileRoot)
      const attachedExternally = inspection.status === 'running'
      proxy = attachedExternally ? null : this.proxyPool.acquire(accountId)
      const opened = await manager.open(account, settings.profileRoot, executable, proxy)
      if (opened.proxyManagedExternally) this.proxyPool.release(accountId)
      if (proxy && !opened.proxyManagedExternally) {
        if (opened.status === 'started' || opened.status === 'already_open') this.proxyPool.recordSuccess(proxy)
        else if (/proxy/i.test(opened.message)) this.proxyPool.recordFailure(proxy)
      }
      if (opened.status !== 'started' && opened.status !== 'already_open') {
        manager.closeAll()
        const safeMessage = redactEmailComboSecrets(opened.message, [newPassword, account.emailPassword, proxy?.password, proxy?.username])
        return this.simpleError(accountId, safeMessage, account.backupEmail, opened.status)
      }

      const state: ActiveComboAccount = {
        accountId,
        operation,
        recoveryOperation,
        recoveryEmail,
        newPassword,
        stages: emailComboStagePlan(operation),
        stageIndex: 0,
        history: [],
        completedStages: [],
        manager,
        executable,
        profileRoot: settings.profileRoot,
        proxy: opened.proxyManagedExternally ? null : proxy,
        proxyManagedExternally: opened.proxyManagedExternally,
        passwordUpdated: false,
        backupEmail: account.backupEmail
      }
      this.active.set(accountId, state)
      return await this.runStages(state, false)
    } catch {
      manager.closeAll()
      this.proxyPool.release(accountId)
      return this.simpleError(accountId, 'Không thể khởi động Combo Email bằng profile/session đã cấu hình.', account.backupEmail)
    }
  }

  private async runStages(state: ActiveComboAccount, confirmCurrentStage: boolean): Promise<HotmailComboActionResult> {
    let confirm = confirmCurrentStage
    while (state.stageIndex < state.stages.length) {
      const stage = state.stages[state.stageIndex]!
      const outcome = await this.executeStage(state, stage, confirm)
      const safeMessage = redactEmailComboSecrets(outcome.message, this.secretValues(state))
      const stageResult: HotmailComboStageResult = {
        stage,
        status: outcome.status,
        message: safeMessage,
        ...(outcome.needsAttentionReason ? { needsAttentionReason: outcome.needsAttentionReason } : {})
      }
      state.history.push(stageResult)

      const progress = advanceEmailComboStage(state.stageIndex, outcome.status, state.stages.length)
      if (outcome.status === 'success') {
        state.completedStages.push(stage)
        state.stageIndex = progress.nextStageIndex
        this.repository.updateEmailState(state.accountId, { lastError: null })
        if (progress.completed) {
          const result = this.finishResult(state, 'success', 'Combo Email đã hoàn tất đủ stage theo thứ tự.')
          this.finishAccount(state)
          return result
        }
        confirm = false
        continue
      }

      this.repository.updateEmailState(state.accountId, { lastError: safeMessage })
      if (outcome.status === 'needs_attention') {
        return this.finishResult(state, 'needs_attention', safeMessage, stage)
      }

      const result = this.finishResult(state, outcome.status, safeMessage)
      this.finishAccount(state)
      return result
    }

    const result = this.finishResult(state, 'success', 'Combo Email đã hoàn tất.')
    this.finishAccount(state)
    return result
  }

  private async executeStage(state: ActiveComboAccount, stage: HotmailComboStage, confirmCompleted: boolean): Promise<StageOutcome> {
    const account = this.accounts.getById(state.accountId)
    if (!account) return { status: 'error', message: 'Account không còn tồn tại.' }

    if (stage === 'password') {
      const result = await state.manager.runPasswordAction(
        account,
        state.profileRoot,
        state.executable,
        state.proxyManagedExternally ? null : state.proxy,
        state.newPassword,
        confirmCompleted
      )
      if (result.status === 'success') {
        this.accounts.update(state.accountId, { emailPassword: state.newPassword })
        state.passwordUpdated = true
      }
      return {
        status: result.status,
        message: result.message,
        ...(result.needsAttentionReason ? { needsAttentionReason: result.needsAttentionReason } : {})
      }
    }

    const recoveryOperation: HotmailRecoveryOperation = stage === 'recovery_remove' ? 'remove' : state.recoveryOperation
    const result = await state.manager.runRecoveryAction(
      account,
      state.profileRoot,
      state.executable,
      state.proxyManagedExternally ? null : state.proxy,
      recoveryOperation,
      account.backupEmail,
      confirmCompleted
    )
    if (result.status === 'success') {
      const nextBackupEmail = canonicalBackupEmailAfterRecoverySuccess(
        recoveryOperation,
        recoveryOperation === 'remove' ? null : state.recoveryEmail
      )
      const updated = this.accounts.update(state.accountId, { backupEmail: nextBackupEmail })
      state.backupEmail = updated.backupEmail
    }
    return {
      status: result.status,
      message: result.message,
      ...(result.needsAttentionReason ? { needsAttentionReason: result.needsAttentionReason } : {})
    }
  }

  private finishResult(
    state: ActiveComboAccount,
    status: HotmailActionStatus,
    message: string,
    pendingStage?: HotmailComboStage
  ): HotmailComboActionResult {
    return {
      accountId: state.accountId,
      status,
      message,
      stages: [...state.history],
      completedStages: [...state.completedStages],
      ...(pendingStage ? { pendingStage } : {}),
      passwordUpdated: state.passwordUpdated,
      backupEmail: state.backupEmail
    }
  }

  private finishAccount(state: ActiveComboAccount): void {
    this.active.delete(state.accountId)
    state.manager.closeAll()
    this.proxyPool.release(state.accountId)
  }

  private secretValues(state: ActiveComboAccount): Array<string | null | undefined> {
    const account = this.accounts.getById(state.accountId)
    return [state.newPassword, account?.emailPassword, state.proxy?.password, state.proxy?.username, state.proxy?.key]
  }

  private simpleError(
    accountId: number,
    message: string,
    backupEmail: string | null = null,
    status: HotmailActionStatus = 'error'
  ): HotmailComboActionResult {
    return {
      accountId,
      status,
      message,
      stages: [],
      completedStages: [],
      passwordUpdated: false,
      backupEmail
    }
  }
}
