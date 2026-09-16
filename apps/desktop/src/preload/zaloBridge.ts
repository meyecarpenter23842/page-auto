import { contextBridge, ipcRenderer } from 'electron'
import {
  ZALO_IPC,
  type ZaloAccountDraft,
  type ZaloAccountIdPayload,
  type ZaloAccountUpdatePayload,
  type ZaloAccountView,
  type ZaloBrowserSettings,
  type ZaloLoginMode,
  type ZaloLoginPayload,
  type ZaloOpenResult
} from '../shared/zalo'

export interface ZaloPreloadApi {
  listAccounts: () => Promise<ZaloAccountView[]>
  createAccount: (input: ZaloAccountDraft) => Promise<ZaloAccountView>
  updateAccount: (payload: ZaloAccountUpdatePayload) => Promise<ZaloAccountView>
  deleteAccount: (id: number) => Promise<boolean>
  openAccount: (id: number) => Promise<ZaloOpenResult>
  loginAccount: (id: number, mode: ZaloLoginMode) => Promise<ZaloOpenResult>
  closeAccount: (id: number) => Promise<boolean>
  getSettings: () => Promise<ZaloBrowserSettings>
  saveSettings: (input: ZaloBrowserSettings) => Promise<ZaloBrowserSettings>
}

const payload = (id: number): ZaloAccountIdPayload => ({ id })
const loginPayload = (id: number, mode: ZaloLoginMode): ZaloLoginPayload => ({ id, mode })

const api: ZaloPreloadApi = {
  listAccounts: () => ipcRenderer.invoke(ZALO_IPC.list),
  createAccount: (input) => ipcRenderer.invoke(ZALO_IPC.create, input),
  updateAccount: (input) => ipcRenderer.invoke(ZALO_IPC.update, input),
  deleteAccount: (id) => ipcRenderer.invoke(ZALO_IPC.delete, payload(id)),
  openAccount: (id) => ipcRenderer.invoke(ZALO_IPC.open, payload(id)),
  loginAccount: (id, mode) => ipcRenderer.invoke(ZALO_IPC.login, loginPayload(id, mode)),
  closeAccount: (id) => ipcRenderer.invoke(ZALO_IPC.close, payload(id)),
  getSettings: () => ipcRenderer.invoke(ZALO_IPC.settingsGet),
  saveSettings: (input) => ipcRenderer.invoke(ZALO_IPC.settingsSave, input)
}

contextBridge.exposeInMainWorld('pageAutoZalo', api)
