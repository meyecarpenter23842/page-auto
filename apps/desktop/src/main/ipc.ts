import { app, ipcMain } from 'electron'
import { IPC_CHANNELS, type AppInfo } from '../ipc/channels'

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.appInfo, (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion()
    }
  })
}
