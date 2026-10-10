import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { APP_UPDATER_IPC, type AppUpdaterSnapshot } from '../shared/appUpdater'

export interface AppUpdaterPreloadApi {
  getState: () => Promise<AppUpdaterSnapshot>
  check: () => Promise<AppUpdaterSnapshot>
  install: () => Promise<AppUpdaterSnapshot>
  onStateChanged: (listener: (state: AppUpdaterSnapshot) => void) => () => void
}

const api: AppUpdaterPreloadApi = {
  getState: () => ipcRenderer.invoke(APP_UPDATER_IPC.getState) as Promise<AppUpdaterSnapshot>,
  check: () => ipcRenderer.invoke(APP_UPDATER_IPC.check) as Promise<AppUpdaterSnapshot>,
  install: () => ipcRenderer.invoke(APP_UPDATER_IPC.install) as Promise<AppUpdaterSnapshot>,
  onStateChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, state: AppUpdaterSnapshot): void => listener(state)
    ipcRenderer.on(APP_UPDATER_IPC.stateChanged, handler)
    return () => ipcRenderer.removeListener(APP_UPDATER_IPC.stateChanged, handler)
  }
}

contextBridge.exposeInMainWorld('pageAutoUpdater', api)
