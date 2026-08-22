import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type AppInfo } from '../ipc/channels'

const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC_CHANNELS.appInfo) as Promise<AppInfo>
}

contextBridge.exposeInMainWorld('pageAuto', api)

export type PageAutoApi = typeof api
