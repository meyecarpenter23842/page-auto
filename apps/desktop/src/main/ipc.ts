import { app, ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  IPC_CHANNELS,
  type AccountColumnLayoutPayload,
  type AccountDeletePayload,
  type AccountOpenProfilePayload,
  type AccountUpdatePayload,
  type AppInfo
} from '../ipc/channels'
import type {
  AccountDraft,
  AccountImportRequest,
  AccountListFilters,
  SaveImportPresetInput
} from '../shared/accounts'
import { BrowserProfileManager } from './browser/browserProfileManager'
import { AccountRepository } from './database/accountRepository'

interface RegisterIpcOptions {
  database: Database.Database
  dataDirectory: string
}

export interface IpcRuntime {
  dispose: () => void
}

export function registerIpcHandlers(options: RegisterIpcOptions): IpcRuntime {
  const accounts = new AccountRepository(options.database)
  const browserProfiles = new BrowserProfileManager(options.dataDirectory)

  ipcMain.handle(IPC_CHANNELS.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion()
  }))

  ipcMain.handle(IPC_CHANNELS.accountsList, (_event, filters?: AccountListFilters) => accounts.list(filters))
  ipcMain.handle(IPC_CHANNELS.accountsCreate, (_event, input: AccountDraft) => accounts.create(input))
  ipcMain.handle(IPC_CHANNELS.accountsUpdate, (_event, payload: AccountUpdatePayload) =>
    accounts.update(payload.id, payload.patch)
  )
  ipcMain.handle(IPC_CHANNELS.accountsDelete, (_event, payload: AccountDeletePayload) =>
    accounts.delete(payload.ids)
  )
  ipcMain.handle(IPC_CHANNELS.accountsImport, (_event, request: AccountImportRequest) => accounts.import(request))
  ipcMain.handle(IPC_CHANNELS.accountPresetsList, () => accounts.listImportPresets())
  ipcMain.handle(IPC_CHANNELS.accountPresetsSave, (_event, input: SaveImportPresetInput) =>
    accounts.saveImportPreset(input)
  )
  ipcMain.handle(IPC_CHANNELS.accountPresetsDelete, (_event, id: number) => accounts.deleteImportPreset(id))
  ipcMain.handle(IPC_CHANNELS.accountColumnLayoutGet, () => accounts.getColumnLayout('accounts'))
  ipcMain.handle(IPC_CHANNELS.accountColumnLayoutSave, (_event, payload: AccountColumnLayoutPayload) => {
    accounts.saveColumnLayout('accounts', payload.layout)
  })
  ipcMain.handle(IPC_CHANNELS.accountOpenProfile, (_event, payload: AccountOpenProfilePayload) => {
    if (!accounts.getById(payload.accountId)) {
      return { status: 'error', message: 'Account không tồn tại.' }
    }
    return browserProfiles.open(payload.accountId)
  })

  return {
    dispose: () => browserProfiles.closeAll()
  }
}
