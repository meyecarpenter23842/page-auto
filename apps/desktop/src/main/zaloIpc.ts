import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  ZALO_IPC,
  type ZaloAccountDraft,
  type ZaloAccountIdPayload,
  type ZaloAccountUpdatePayload,
  type ZaloBrowserSettings
} from '../shared/zalo'
import { ZaloAccountRepository } from './database/zaloRepository'
import { ZaloSettingsRepository } from './database/zaloSettingsRepository'
import { ZaloBrowserRuntime } from './zalo/zaloBrowserRuntime'

export interface ZaloIpcRuntime { dispose: () => void }

export function registerZaloIpc(client: Database.Database, dataDirectory: string): ZaloIpcRuntime {
  const accounts = new ZaloAccountRepository(client)
  const settings = new ZaloSettingsRepository(client)
  const browser = new ZaloBrowserRuntime(dataDirectory, accounts, () => settings.get())

  const handlers = [
    ZALO_IPC.list,
    ZALO_IPC.create,
    ZALO_IPC.update,
    ZALO_IPC.delete,
    ZALO_IPC.open,
    ZALO_IPC.close,
    ZALO_IPC.settingsGet,
    ZALO_IPC.settingsSave
  ]
  for (const channel of handlers) ipcMain.removeHandler(channel)

  ipcMain.handle(ZALO_IPC.list, () => accounts.list())
  ipcMain.handle(ZALO_IPC.create, (_event, input: ZaloAccountDraft) => accounts.create(input))
  ipcMain.handle(ZALO_IPC.update, (_event, payload: ZaloAccountUpdatePayload) => accounts.update(payload))
  ipcMain.handle(ZALO_IPC.delete, async (_event, payload: ZaloAccountIdPayload) => {
    await browser.close(payload.id)
    return accounts.delete(payload.id)
  })
  ipcMain.handle(ZALO_IPC.open, async (_event, payload: ZaloAccountIdPayload) => {
    const account = accounts.get(payload.id)
    if (!account) throw new Error(`Không tìm thấy Zalo account #${payload.id}.`)
    return browser.open(account)
  })
  ipcMain.handle(ZALO_IPC.close, async (_event, payload: ZaloAccountIdPayload) => {
    await browser.close(payload.id)
    return true
  })
  ipcMain.handle(ZALO_IPC.settingsGet, () => settings.get())
  ipcMain.handle(ZALO_IPC.settingsSave, (_event, input: ZaloBrowserSettings) => {
    const saved = settings.save(input)
    browser.applySettingsToOpenBrowsers(saved)
    return saved
  })

  return {
    dispose: () => {
      browser.closeAll()
      for (const channel of handlers) ipcMain.removeHandler(channel)
    }
  }
}
