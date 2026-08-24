import { dialog, ipcMain, shell } from 'electron'
import type Database from 'better-sqlite3'
import { IPC_CHANNELS } from '../ipc/channels'
import type { SaveHotmailSettingsInput, HotmailAccountPayload, HotmailBatchPayload } from '../shared/hotmail'
import { AppSettingsRepository } from './database/appSettingsRepository'
import { AccountRepository } from './database/accountRepository'
import { HotmailRepository } from './database/hotmailRepository'
import { ElectronEmailSecretCipher } from './email/emailSecretStore'
import { HotmailService } from './email/hotmailService'

export interface HotmailIpcRuntime {
  dispose: () => void
}

export function registerHotmailIpcHandlers(database: Database.Database): HotmailIpcRuntime {
  const accounts = new AccountRepository(database)
  const appSettings = new AppSettingsRepository(database)
  const repository = new HotmailRepository(database)
  const service = new HotmailService(
    accounts,
    repository,
    new ElectronEmailSecretCipher(),
    () => appSettings.get().browser.executablePath
  )

  ipcMain.handle(IPC_CHANNELS.hotmailDashboardList, () => service.listDashboard())
  ipcMain.handle(IPC_CHANNELS.hotmailSettingsGet, () => service.getSettings())
  ipcMain.handle(IPC_CHANNELS.hotmailSettingsSave, (_event, input: SaveHotmailSettingsInput) => service.saveSettings(input))
  ipcMain.handle(IPC_CHANNELS.hotmailPickProfileRoot, async () => {
    const result = await dialog.showOpenDialog({ title: 'Chọn thư mục profile MaxHotmail', properties: ['openDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC_CHANNELS.hotmailPickBrowserExecutable, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Chọn browser executable cho MaxHotmail',
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

  return { dispose: () => service.dispose() }
}
