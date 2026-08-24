import { dialog, ipcMain, shell } from 'electron'
import type Database from 'better-sqlite3'
import { IPC_CHANNELS } from '../ipc/channels'
import type { SaveHotmailSettingsInput, HotmailAccountPayload, HotmailBatchPayload } from '../shared/hotmail'
import { BrowserEngineService } from './browser/browserEngineService'
import { AppSettingsRepository } from './database/appSettingsRepository'
import { AccountRepository } from './database/accountRepository'
import { HotmailRepository } from './database/hotmailRepository'
import { emailBrowserExecutableCandidates } from './email/emailBrowserExecutable'
import { ElectronEmailSecretCipher } from './email/emailSecretStore'
import { HotmailService } from './email/hotmailService'

export interface HotmailIpcRuntime {
  dispose: () => void
}

export function registerHotmailIpcHandlers(database: Database.Database): HotmailIpcRuntime {
  const accounts = new AccountRepository(database)
  const appSettings = new AppSettingsRepository(database)
  const repository = new HotmailRepository(database)
  const browserEngine = new BrowserEngineService()
  const validatedExecutables = new Set<string>()

  const resolveBrowserExecutable = async (requestedExecutable: string, profileRoot: string): Promise<string> => {
    const candidates = emailBrowserExecutableCandidates(
      profileRoot,
      requestedExecutable,
      appSettings.get().browser.executablePath
    )
    if (candidates.length === 0) {
      throw new Error('Không tìm thấy Browser Email. Anh chửn Chrome/Edge/Chromium chạy được trong Thiết lập Email.')
    }

    let foundExecutable = false
    for (const candidate of candidates) {
      const probe = await browserEngine.probeExecutable(candidate)
      if (probe.status !== 'found') continue
      foundExecutable = true
      if (validatedExecutables.has(candidate)) return candidate

      const result = await browserEngine.testBrowser({
        ...appSettings.get().browser,
        executablePath: candidate,
        mode: 'visible'
      })
      if (result.status === 'success') {
        validatedExecutables.add(candidate)
        return candidate
      }

      if (requestedExecutable.trim()) {
        throw new Error('Browser Email không khởi động được. Anh chọn một Chrome/Edge/Chromium khác rồi lưu lại.')
      }
    }

    if (requestedExecutable.trim() && !foundExecutable) {
      throw new Error('Không tìm thấy file Browser Email đã chửn.')
    }
    if (foundExecutable) {
      throw new Error('Browser Email không khởi động được. Anh chọn một Chrome/Edge/Chromium khác rồi lưu lại.')
    }
    throw new Error('Không tìm thấy Browser Email chạy được. Anh chọn file browser thủ công trong Thiết lập Email.')
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
    const result = await dialog.showOpenDialog({ title: 'Chọn Email Profile Root', properties: ['openDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC_CHANNELS.hotmailPickBrowserExecutable, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Chửn Browser Email',
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
