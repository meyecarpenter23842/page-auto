import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../ipc/channels'
import type { BrowserRetileResult } from '../shared/browserWindowLayout'
import type { HotmailOpenBatchPayload, HotmailOpenBatchResult } from '../shared/hotmail'

const api = {
  openBatch: (payload: HotmailOpenBatchPayload): Promise<HotmailOpenBatchResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.hotmailOpenBatch, payload) as Promise<HotmailOpenBatchResult>,
  retile: (): Promise<BrowserRetileResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.hotmailRetile) as Promise<BrowserRetileResult>
}

contextBridge.exposeInMainWorld('pageAutoEmailBrowser', api)

export type EmailBrowserLayoutPreloadApi = typeof api
