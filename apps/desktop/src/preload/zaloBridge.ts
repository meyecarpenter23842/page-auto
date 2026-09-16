import { contextBridge, ipcRenderer } from 'electron'
import {
  ZALO_IPC,
  type ZaloAccountDraft,
  type ZaloAccountIdPayload,
  type ZaloAccountRecord,
  type ZaloAccountUpdatePayload,
  type ZaloBrowserSettings,
  type ZaloOpenResult
} from '../shared/zalo'

export interface ZaloPreloadApi {
  listAccounts: () => Promise<ZaloAccountRecord[]>
  createAccount: (input: ZaloAccountDraft) => Promise<ZaloAccountRecord>
  updateAccount: (payload: ZaloAccountUpdatePayload) => Promise<ZaloAccountRecord>
  deleteAccount: (id: number) => Promise<boolean>
  openAccount: (id: number) => Promise<ZaloOpenResult>
  closeAccount: (id: number) => Promise<boolean>
  getSettings: () => Promise<ZaloBrowserSettings>
  saveSettings: (input: ZaloBrowserSettings) => Promise<ZaloBrowserSettings>
}

const payload = (id: number): ZaloAccountIdPayload => ({ id })

const api: ZaloPreloadApi = {
  listAccounts: () => ipcRenderer.invoke(ZALO_IPC.list),
  createAccount: (input) => ipcRenderer.invoke(ZALO_IPC.create, input),
  updateAccount: (input) => ipcRenderer.invoke(ZALO_IPC.update, input),
  deleteAccount: (id) => ipcRenderer.invoke(ZALO_IPC.delete, payload(id)),
  openAccount: (id) => ipcRenderer.invoke(ZALO_IPC.open, payload(id)),
  closeAccount: (id) => ipcRenderer.invoke(ZALO_IPC.close, payload(id)),
  getSettings: () => ipcRenderer.invoke(ZALO_IPC.settingsGet),
  saveSettings: (input) => ipcRenderer.invoke(ZALO_IPC.settingsSave, input)
}

contextBridge.exposeInMainWorld('pageAutoZalo', api)
