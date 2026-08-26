import { dialog, ipcMain, shell } from 'electron'
import type Database from 'better-sqlite3'
import { IPC_CHANNELS } from '../ipc/channels'
import type { SaveHotmailSettingsInput, HotmailAccountPayload, HotmailBatchPayload } from '../shared/hotmail'
import { BrowserEngineService } from './browser/browserEngineService'
import { AccountRepository } from './database/accountRepository'
import { HotmailRepository } from './database/hotmailRepository'
import { emailBrowserExecutableCandidates } from './email/emailBrowserExecutable'
import { testEmailBrowserExecutable } from './email/emailProxyTester'
import { ElectronEmailSecretCipher } from './email/emailSecretStore'
import { HotmailService } from './email/hotmailService'

export interface HotmailIpcRuntime {
  dispose: () => void
}

export function registerHotmailIpcHandlers(database: Database.Database): HotmailIpcRuntime {
  const accounts = new AccountRepository(database)
  const repository = new HotmailRepository(database)
  const browserEngine = new BrowserEngineService()
  const validatedExecutables = new Set<string>()

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

      // Validate Email Browser with a disposable persistent profile, matching the
      // real Email runtime. Do not borrow Facebook browser settings or profile.
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

  const service = new HotmailService(
    accounts,
    repository,
    new ElectronEmailSecretCipher(),
    resolveBrowserExecutable
  )

  ipcMain.handle(IPC_CHANNELS.hotmailDashboardList, () => service.listDashboard())
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
  ipcMain.handle(IPC_CHANNELS.hotmailCodesGet, (_event, payload: HotmailBatchPayload) => service.getCodes(payload))
  ipcMain.handle(IPC_CHANNELS.hotmailCheck, (_event, payload: HotmailBatchPayload) => service.checkMail(payload))
  ipcMain.handle(IPC_CHANNELS.hotmailOpen, (_event, payload: HotmailAccountPayload) => service.openMail(payload.accountId))
  ipcMain.handle(IPC_CHANNELS.hotmailProxyStatus, () => service.getProxyStatus())
  ipcMain.handle(IPC_CHANNELS.hotmailProxyRotate, () => service.rotateProxy())
  ipcMain.handle(IPC_CHANNELS.hotmailProxyTest, () => service.testProxy())

  return {
    dispose: () => {
      service.dispose()
      browserEngine.closeAll()
    }
  }
}
