import { contextBridge, ipcRenderer } from 'electron'
import {
  ZALO_IPC,
  type ZaloAccountDraft,
  type ZaloAccountIdPayload,
  type ZaloAccountUpdatePayload,
  type ZaloAccountView,
  type ZaloActionInput,
  type ZaloActionRequestPayload,
  type ZaloActionResult,
  type ZaloBatchRunIdPayload,
  type ZaloBatchRunSnapshot,
  type ZaloBatchStartPayload,
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
  executeAction: (id: number, action: ZaloActionInput) => Promise<ZaloActionResult>
  pauseAction: (id: number) => Promise<boolean>
  resumeAction: (id: number) => Promise<boolean>
  stopAction: (id: number) => Promise<boolean>
  startBatch: (input: ZaloBatchStartPayload) => Promise<ZaloBatchRunSnapshot>
  getBatchStatus: (runId: string) => Promise<ZaloBatchRunSnapshot | null>
  pauseBatch: (runId: string) => Promise<ZaloBatchRunSnapshot | null>
  resumeBatch: (runId: string) => Promise<ZaloBatchRunSnapshot | null>
  stopBatch: (runId: string) => Promise<ZaloBatchRunSnapshot | null>
  getSettings: () => Promise<ZaloBrowserSettings>
  saveSettings: (input: ZaloBrowserSettings) => Promise<ZaloBrowserSettings>
}

const payload = (id: number): ZaloAccountIdPayload => ({ id })
const loginPayload = (id: number, mode: ZaloLoginMode): ZaloLoginPayload => ({ id, mode })
const actionPayload = (id: number, action: ZaloActionInput): ZaloActionRequestPayload => ({ id, action })
const batchPayload = (runId: string): ZaloBatchRunIdPayload => ({ runId })

const api: ZaloPreloadApi = {
  listAccounts: () => ipcRenderer.invoke(ZALO_IPC.list),
  createAccount: (input) => ipcRenderer.invoke(ZALO_IPC.create, input),
  updateAccount: (input) => ipcRenderer.invoke(ZALO_IPC.update, input),
  deleteAccount: (id) => ipcRenderer.invoke(ZALO_IPC.delete, payload(id)),
  openAccount: (id) => ipcRenderer.invoke(ZALO_IPC.open, payload(id)),
  loginAccount: (id, mode) => ipcRenderer.invoke(ZALO_IPC.login, loginPayload(id, mode)),
  closeAccount: (id) => ipcRenderer.invoke(ZALO_IPC.close, payload(id)),
  executeAction: (id, action) => ipcRenderer.invoke(ZALO_IPC.actionExecute, actionPayload(id, action)),
  pauseAction: (id) => ipcRenderer.invoke(ZALO_IPC.actionPause, payload(id)),
  resumeAction: (id) => ipcRenderer.invoke(ZALO_IPC.actionResume, payload(id)),
  stopAction: (id) => ipcRenderer.invoke(ZALO_IPC.actionStop, payload(id)),
  startBatch: (input) => ipcRenderer.invoke(ZALO_IPC.batchStart, input),
  getBatchStatus: (runId) => ipcRenderer.invoke(ZALO_IPC.batchStatus, batchPayload(runId)),
  pauseBatch: (runId) => ipcRenderer.invoke(ZALO_IPC.batchPause, batchPayload(runId)),
  resumeBatch: (runId) => ipcRenderer.invoke(ZALO_IPC.batchResume, batchPayload(runId)),
  stopBatch: (runId) => ipcRenderer.invoke(ZALO_IPC.batchStop, batchPayload(runId)),
  getSettings: () => ipcRenderer.invoke(ZALO_IPC.settingsGet),
  saveSettings: (input) => ipcRenderer.invoke(ZALO_IPC.settingsSave, input)
}

contextBridge.exposeInMainWorld('pageAutoZalo', api)
