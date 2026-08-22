import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type AccountColumnLayoutPayload,
  type AccountDeletePayload,
  type AccountOpenProfilePayload,
  type AccountUpdatePayload,
  type AppInfo
} from '../ipc/channels'
import type {
  AccountColumnLayout,
  AccountDraft,
  AccountImportRequest,
  AccountImportResult,
  AccountListFilters,
  AccountRecord,
  BrowserProfileResult,
  ImportPreset,
  SaveImportPresetInput
} from '../shared/accounts'

const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC_CHANNELS.appInfo) as Promise<AppInfo>,
  listAccounts: (filters?: AccountListFilters): Promise<AccountRecord[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountsList, filters) as Promise<AccountRecord[]>,
  createAccount: (input: AccountDraft): Promise<AccountRecord> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountsCreate, input) as Promise<AccountRecord>,
  updateAccount: (payload: AccountUpdatePayload): Promise<AccountRecord> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountsUpdate, payload) as Promise<AccountRecord>,
  deleteAccounts: (payload: AccountDeletePayload): Promise<number> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountsDelete, payload) as Promise<number>,
  importAccounts: (request: AccountImportRequest): Promise<AccountImportResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountsImport, request) as Promise<AccountImportResult>,
  listImportPresets: (): Promise<ImportPreset[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountPresetsList) as Promise<ImportPreset[]>,
  saveImportPreset: (input: SaveImportPresetInput): Promise<ImportPreset> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountPresetsSave, input) as Promise<ImportPreset>,
  deleteImportPreset: (id: number): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountPresetsDelete, id) as Promise<boolean>,
  getAccountColumnLayout: (): Promise<AccountColumnLayout | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountColumnLayoutGet) as Promise<AccountColumnLayout | null>,
  saveAccountColumnLayout: (payload: AccountColumnLayoutPayload): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountColumnLayoutSave, payload) as Promise<void>,
  openAccountProfile: (payload: AccountOpenProfilePayload): Promise<BrowserProfileResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountOpenProfile, payload) as Promise<BrowserProfileResult>
}

contextBridge.exposeInMainWorld('pageAuto', api)

export type PageAutoApi = typeof api
