import { dialog, ipcMain, shell } from 'electron'
import type Database from 'better-sqlite3'
import { IPC_CHANNELS } from '../ipc/channels'
import { EMAIL_CODE_DB_RETENTION_MS, type EmailCodeProvider } from '../shared/emailCode'
import type {
  SaveHotmailSettingsInput,
  HotmailAccountPayload,
  HotmailBatchPayload,
  HotmailBatchResult,
  HotmailPasswordActionPayload,
  HotmailRecoveryActionPayload
} from '../shared/hotmail'
import { BrowserEngineService } from './browser/browserEngineService'
import { AccountRepository } from './database/accountRepository'
import { HotmailRepository } from './database/hotmailRepository'
import { createCanonicalEmailCodeRuntime } from './email/canonicalEmailCodeProvider'
import { emailBrowserExecutableCandidates } from './email/emailBrowserExecutable'
import { testEmailBrowserExecutable } from './email/emailProxyTester'
import { ElectronEmailSecretCipher } from './email/emailSecretStore'
import { HotmailService } from './email/hotmailService'
import { clearEmailCodeProvider, setEmailCodeProvider } from './services/emailCodeProviderRegistry'

export interface HotmailIpcRuntime {
  dispose: () => void
}

function uniqueAccountIds(payload: HotmailBatchPayload): number[] {
  return [...new Set(payload.accountIds.filter((id) => Number.isInteger(id) && id > 0))]
}

function needsAttentionAccountIds(results: Array<{ accountId: number; status: string }>): number[] {
  return results.filter((item) => item.status === 'needs_attention').map((item) => item.accountId)
}

async function getManualCodes(provider: EmailCodeProvider, payload: HotmailBatchPayload): Promise<HotmailBatchResult> {
  const results: HotmailBatchResult['results'] = []
  for (const accountId of uniqueAccountIds(payload)) {
    const result = await provider.getEmailCode({ accountId, consumer: 'manual', timeoutMs: 0 })
    results.push(result.status === 'success'
      ? {
          accountId,
          status: 'success',
          message: result.message,
          code: result.code,
          receivedAt: result.receivedAt
        }
      : { accountId, status: 'error', message: result.message, code: null, receivedAt: null })
  }
  return { results }
}

export function registerHotmailIpcHandlers(database: Database.Database): HotmailIpcRuntime {
  const accounts = new AccountRepository(database)
  const repository = new HotmailRepository(database)
  const browserEngine = new BrowserEngineService()
  const validatedExecutables = new Set<string>()
  let pendingRecoveryPayload: HotmailRecoveryActionPayload | null = null
  let pendingPasswordPayload: HotmailPasswordActionPayload | null = null

  const resolveBrowserExecutable = async (requestedExecutable: string, profileRoot: string): Promise<string> => {
    const candidates = emailBrowserExecutableCandidates(profileRoot, requestedExecutable)
    if (candidates.length === 0) {
      throw new Error('Không tìm thấy Browser Email. Anh chọn Chrome/Edge/Chromium chạy được trong Cài đặt Email.')
    }

    let foundExecutable = false
    for (const candidate of candidates) {
      const probe = await browserEngine.probeExecutable(candidate)
      if (probe.status !== 'found') continue
      foundExecutable = true
      if (validatedExecutables.has(candidate)) return candidate

      const result = await testEmailBrowserExecutable(candidate)
      if (result.ok) {
        validatedExecutables.add(candidate)
        return candidate
      }

      if (requestedExecutable.trim()) {
        throw new Error('Browser Email đã chọn không mở persistent profile được. Anh chọn Chrome/Edge/Chromium khác rồi thử lại.')
      }
    }

    if (requestedExecutable.trim() && !foundExecutable) {
      throw new Error('Không tìm thấy file Browser Email đã chọn.')
    }
    if (foundExecutable) {
      throw new Error('Các Browser Email tự tìm thấy đều không mở persistent profile được. Anh chọn file browser thủ công trong Cài đặt Email.')
    }
    throw new Error('Không tìm thấy Browser Email chạy được. Anh chọn file browser thủ công trong Cài đặt Email.')
  }

  const cipher = new ElectronEmailSecretCipher()
  const service = new HotmailService(
    accounts,
    repository,
    cipher,
    resolveBrowserExecutable
  )
  const codeRuntime = createCanonicalEmailCodeRuntime(accounts, repository, cipher)
  setEmailCodeProvider(codeRuntime.provider)

  const listDashboard = async () => {
    let rows = await service.listDashboard()
    const cutoff = Date.now() - EMAIL_CODE_DB_RETENTION_MS
    let purged = false
    for (const row of rows) {
      if (!row.latestCode) continue
      if (row.lastCodeAt !== null && row.lastCodeAt >= cutoff) continue
      repository.updateEmailState(row.accountId, { lastCode: null, lastCodeAt: null })
      purged = true
    }
    if (purged) rows = await service.listDashboard()
    return rows
  }

  ipcMain.handle(IPC_CHANNELS.hotmailDashboardList, () => listDashboard())
  ipcMain.handle(IPC_CHANNELS.hotmailSettingsGet, () => service.getSettings())
  ipcMain.handle(IPC_CHANNELS.hotmailSettingsSave, (_event, input: SaveHotmailSettingsInput) => service.saveSettings(input))
  ipcMain.handle(IPC_CHANNELS.hotmailPickProfileRoot, async () => {
    const savedRoot = repository.getProfileSettings().profileRoot
    const result = await dialog.showOpenDialog({
      title: 'Chọn thư mục chứa profile Email theo UID',
      properties: ['openDirectory'],
      ...(savedRoot ? { defaultPath: savedRoot } : {})
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC_CHANNELS.hotmailPickBrowserExecutable, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Chọn Browser Email',
      properties: ['openFile'],
      ...(process.platform === 'win32' ? { filters: [{ name: 'Browser', extensions: ['exe'] }] } : {})
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC_CHANNELS.hotmailOAuthStart, async (_event, payload: HotmailAccountPayload) => {
    const result = await service.startOAuth(payload.accountId)
    if (result.verificationUri) void shell.openExternal(result.verificationUri).catch(() => undefined)
    return result
  })
  ipcMain.handle(IPC_CHANNELS.hotmailCodesGet, (_event, payload: HotmailBatchPayload) => getManualCodes(codeRuntime.provider, payload))
  ipcMain.handle(IPC_CHANNELS.hotmailCheck, (_event, payload: HotmailBatchPayload) => service.checkMail(payload))
  ipcMain.handle(IPC_CHANNELS.hotmailOpen, (_event, payload: HotmailAccountPayload) => service.openMail(payload.accountId))

  ipcMain.handle(IPC_CHANNELS.hotmailRecoveryAction, async (_event, payload: HotmailRecoveryActionPayload) => {
    if (payload.confirmCompleted) {
      if (!pendingRecoveryPayload) {
        throw new Error('Không có flow Mail khôi phục nào đang chờ xác nhận. Hãy mở lại flow trước.')
      }
      const frozenPayload: HotmailRecoveryActionPayload = {
        accountIds: [...pendingRecoveryPayload.accountIds],
        operation: pendingRecoveryPayload.operation,
        ...(pendingRecoveryPayload.recoveryEmail !== undefined ? { recoveryEmail: pendingRecoveryPayload.recoveryEmail } : {}),
        confirmCompleted: true
      }
      const result = await service.updateRecoveryMail(frozenPayload)
      const attentionIds = needsAttentionAccountIds(result.results)
      pendingRecoveryPayload = attentionIds.length > 0
        ? {
            accountIds: attentionIds,
            operation: frozenPayload.operation,
            ...(frozenPayload.recoveryEmail !== undefined ? { recoveryEmail: frozenPayload.recoveryEmail } : {}),
            confirmCompleted: false
          }
        : null
      return result
    }

    if (pendingRecoveryPayload || pendingPasswordPayload) {
      throw new Error('Đang có một flow bảo mật Email chờ xác nhận. Hoàn tất flow đó trước khi mở thao tác mới.')
    }

    const frozenPayload: HotmailRecoveryActionPayload = {
      accountIds: [...payload.accountIds],
      operation: payload.operation,
      ...(payload.recoveryEmail !== undefined ? { recoveryEmail: payload.recoveryEmail } : {}),
      confirmCompleted: false
    }
    const result = await service.updateRecoveryMail(frozenPayload)
    const attentionIds = needsAttentionAccountIds(result.results)
    if (attentionIds.length > 0) {
      pendingRecoveryPayload = { ...frozenPayload, accountIds: attentionIds }
    }
    return result
  })

  ipcMain.handle(IPC_CHANNELS.hotmailPasswordAction, async (_event, payload: HotmailPasswordActionPayload) => {
    if (payload.confirmCompleted) {
      if (!pendingPasswordPayload?.newPassword) {
        throw new Error('Không có flow đổi Password Email nào đang chờ xác nhận. Hãy mở lại flow trước.')
      }
      const frozenPayload: HotmailPasswordActionPayload = {
        accountIds: [...pendingPasswordPayload.accountIds],
        newPassword: pendingPasswordPayload.newPassword,
        confirmCompleted: true
      }
      const result = await service.updatePassword(frozenPayload)
      const attentionIds = needsAttentionAccountIds(result.results)
      pendingPasswordPayload = attentionIds.length > 0
        ? {
            accountIds: attentionIds,
            newPassword: frozenPayload.newPassword,
            confirmCompleted: false
          }
        : null
      return result
    }

    if (pendingRecoveryPayload || pendingPasswordPayload) {
      throw new Error('Đang có một flow bảo mật Email chờ xác nhận. Hoàn tất flow đó trước khi mở thao tác mới.')
    }

    const frozenPayload: HotmailPasswordActionPayload = {
      accountIds: [...payload.accountIds],
      ...(payload.newPassword !== undefined ? { newPassword: payload.newPassword } : {}),
      confirmCompleted: false
    }
    const result = await service.updatePassword(frozenPayload)
    const attentionIds = needsAttentionAccountIds(result.results)
    if (attentionIds.length > 0) {
      pendingPasswordPayload = { ...frozenPayload, accountIds: attentionIds }
    }
    return result
  })

  ipcMain.handle(IPC_CHANNELS.hotmailProxyStatus, () => service.getProxyStatus())
  ipcMain.handle(IPC_CHANNELS.hotmailProxyRotate, () => service.rotateProxy())
  ipcMain.handle(IPC_CHANNELS.hotmailProxyTest, () => service.testProxy())

  return {
    dispose: () => {
      pendingRecoveryPayload = null
      pendingPasswordPayload = null
      clearEmailCodeProvider(codeRuntime.provider)
      codeRuntime.dispose()
      service.dispose()
      browserEngine.closeAll()
    }
  }
}
